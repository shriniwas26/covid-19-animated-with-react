import './App.css';
import React, { } from 'react';
import * as d3 from 'd3';
import * as fc from 'd3fc';
import 'bootstrap/dist/css/bootstrap.css';
import 'react-bootstrap-range-slider/dist/react-bootstrap-range-slider.css';
// import * as bs from "bootstrap/dist/js/bootstrap.bundle";
import { Spinner, Badge } from 'react-bootstrap';
import RangeSlider from 'react-bootstrap-range-slider';
import Moment from 'moment';
import Button from 'react-bootstrap/Button';
let _ = require('lodash');

const ANIMATION_DELAY = 40;
const PER_POPULATION = 100_000;
const REPORTED_FIELD = "Total_reported";
const DAILY_REPORTED_FIELD = "Daily_" + REPORTED_FIELD;
const DAILY_REPORTED_FIELD_MA = "Daily_" + REPORTED_FIELD + "_ma";
const MOVING_AVG_WINDOW = 14;

window.d3 = d3;


const areaCodeToGmCode = (x) => {
    return "GM" + x.toString().padStart(4, '0');
};

const movingAvg = (inputArr, maWin) => {
    const tempArr = Array(inputArr.length);
    for (let i = 0; i < inputArr.length; i++) {
        tempArr[i] = 0;
        let n = 0;
        for (let j = 0; j < maWin; j++) {
            if (i + j < inputArr.length) {
                n++;
                tempArr[i] = tempArr[i] + inputArr[i + j];
            }
        }
        tempArr[i] = tempArr[i] / n;
    }
    return tempArr;
};

class App extends React.Component {

    constructor(props) {
        super(props);
        this.state = {
            // Data
            populationData: null,
            nlGeoJson: null,
            covidDataGroupedByDay: null,

            // Animation related state
            selectedDayNr: 1,
            numberOfDays: null,
            colorScale: null,
            isPlaying: false
        };
    }

    componentDidMount() {
        const urls = [
            "data/nl-compact.json",
            "data/NL_Population_Latest.csv",
            "data/COVID-19_aantallen_gemeente_cumulatief_min.csv"
        ];

        Promise.all(urls.map(url =>
            fetch(url)
                .then(response => response.text())
        ))
            .then(([nlGeoJsonText, populationDataText, covidDataText]) => {
                const nlGeoJson = JSON.parse(nlGeoJsonText);
                const covidData = d3.csvParse(
                    covidDataText,
                    d3.autoType
                );
                const populationData = d3.csvParse(
                    populationDataText,
                    d3.autoType
                );

                const populationDataDict = Object.fromEntries(
                    populationData.map(elem => {
                        return [
                            elem["Regions"],
                            elem["PopulationOn31December_20"]
                        ];
                    })
                );

                /** Calculate daily values */
                const covidDataGroupedByMunicipality = d3.group(
                    covidData,
                    x => x["Municipality_code"]
                );

                covidDataGroupedByMunicipality.forEach(munData => {
                    munData[0][DAILY_REPORTED_FIELD] = 0;
                    for (let i = 1; i < munData.length; i++) {
                        munData[i][DAILY_REPORTED_FIELD] =
                            munData[i][REPORTED_FIELD] - munData[i - 1][REPORTED_FIELD];
                    }
                    // Compute moving average
                    const movingAvgArr = movingAvg(
                        munData.map(
                            d => d[DAILY_REPORTED_FIELD]
                        ),
                        MOVING_AVG_WINDOW
                    );
                    for (let i = 0; i < munData.length; i++) {
                        munData[i][DAILY_REPORTED_FIELD_MA] = movingAvgArr[i];
                    }
                });

                const covidDataDiffed = Array.from(covidDataGroupedByMunicipality)
                    .map(x => x[1])
                    .flat();

                const populationAdjustedCovidData = covidDataDiffed.map(elem => {
                    const rowData = {};
                    rowData["Date_of_report"] = Moment(elem["Date_of_report"]).format("YYYY, MMMM DD");
                    rowData["Municipality_code"] = elem["Municipality_code"];
                    rowData[DAILY_REPORTED_FIELD_MA] = Math.round(
                        elem[DAILY_REPORTED_FIELD_MA] /
                        populationDataDict[elem["Municipality_code"]] * PER_POPULATION
                    );
                    return rowData;
                });

                const maxVal = 100 * Math.ceil(1 / 100 * d3.max(
                    populationAdjustedCovidData.map(e => e[DAILY_REPORTED_FIELD_MA])));
                const medVal = d3.mean(
                    populationAdjustedCovidData.map(e => e[DAILY_REPORTED_FIELD_MA]));

                const covidDataGroupedByDay = d3.group(populationAdjustedCovidData, x => x["Date_of_report"]);

                populationData.forEach(e => {
                    populationData[e["Regions"]] = + e["PopulationOn1January_1"];
                });

                const colorScale = d3.scaleLinear()
                    .domain([0, medVal, maxVal])
                    .range(["white", "orange", "red"]);

                this.initialMapRender(nlGeoJson, medVal, maxVal, colorScale);

                window.removeEventListener('resize', this.resizeMapThrottled);
                window.addEventListener('resize', this.resizeMapThrottled);

                this.setState({
                    nlGeoJson: nlGeoJson,
                    populationData: populationData,
                    covidData: covidData,
                    covidDataGroupedByDay: covidDataGroupedByDay,
                    numberOfDays: covidDataGroupedByDay.size,
                    colorScale: colorScale,
                });
            });


        const svg = d3.select('#svg-nl-map')
            .attr("height", "60vh");

        svg
            .append("p")
            .attr("x", 300)
            .attr("height", 225)
            .text("Loading...")
            .attr("font-weight", "700");
        // .style("border", "5px solid grey")
    }

    initialMapRender = (nlGeoJson, medVal, maxVal, colorScale) => {
        const svg = d3.select('#svg-nl-map');
        svg.empty();

        const legendSvgGroup = svg
            .append("g")
            .classed("legend-group", true);


        const [legendWidth, legendHeight] = [0.05 * window.innerWidth, 0.2 * window.innerHeight];
        // Band scale for x-axis
        const xScale = d3
            .scaleBand()
            .domain([0, 1])
            .range([0, legendWidth]);

        // Linear scale for y-axis
        const yScale = d3
            .scaleLinear()
            .domain([maxVal, 0])
            .range([0, legendHeight]);

        const expandedDomain = [
            ...d3.range(0, medVal, 2 * (medVal / legendHeight)),
            ...d3.range(medVal, maxVal + 1, 2 * (maxVal / legendHeight))
        ];

        console.log(expandedDomain);

        // Defining the legend bar
        const svgBar = fc
            .autoBandwidth(fc.seriesSvgBar())
            .xScale(xScale)
            .yScale(yScale)
            .crossValue(0)
            .baseValue((_, i) => (i > 0 ? expandedDomain[i - 1] : 0))
            .mainValue(d => d)
            .decorate(selection => {
                selection.selectAll("path").style("fill", d => {
                    return colorScale(d);
                });
            });

        // Add the legend bar
        legendSvgGroup
            .append("g")
            .datum(expandedDomain)
            .call(svgBar);

        const toolDiv = d3.select("#chartArea")
            .append("div")
            .style("visibility", "hidden")
            .style("position", "absolute")
            .style("background-color", "skyblue")
            .style("font", "14px times")
            .style("border-radius", "10px")
            .style("box-sizing", "border-box")
            .style("padding", "10px")
            ;

        // Draw the map
        const projection = d3.geoMercator()
            .fitSize([window.innerWidth / 2, window.innerHeight / 2], nlGeoJson);

        svg.append("g")
            .attr("id", "path-group")
            .classed("nl-map", true)
            .selectAll("path")
            .join()
            .data(nlGeoJson.features)
            .enter()
            .append("path")
            .attr("stroke", "black")
            .attr("stroke-width", 1.0)
            // draw each Municiaplity
            .attr("d", d3.geoPath()
                .projection(projection)
            )
            .attr("id", d => areaCodeToGmCode(d.properties.areaCode))
            .on("mouseover", (e, d) => {
                d3
                    .select(e.target)
                    .attr("stroke-width", 4.0);

                toolDiv
                    .style("visibility", "visible")
                    .text(`Municipality: ${d.properties.areaName}`);
            })
            .on('mousemove', (e, _d) => {
                toolDiv
                    .style('top', (e.pageY - 50) + 'px')
                    .style('left', (e.pageX - 50) + 'px');
            })
            .on('mouseout', (e) => {
                toolDiv.style('visibility', 'hidden');
                d3
                    .select(e.target)
                    .attr("stroke-width", 1.0);
            })
            ;
    };

    resizeMap = () => {
        console.debug(`Resizing map to ${window.innerWidth} x ${window.innerHeight} screen-size`);
        const projection = d3.geoMercator()
            .fitSize([window.innerWidth / 2, window.innerHeight / 2], this.state.nlGeoJson);

        d3.select('#svg-nl-map')
            .selectAll(".nl-map path")
            .join()
            .transition(ANIMATION_DELAY)
            .duration(0)
            .attr("d", d3.geoPath().projection(projection));
    };

    resizeMapThrottled = _.throttle(this.resizeMap, 1000, { leading: false, trailing: true });

    redrawDay = (dayNumber) => {

        const selectedDayIdx = Math.min(
            Math.max(0, dayNumber),
            this.state.numberOfDays - 1
        );

        const dayKey = [...this.state.covidDataGroupedByDay.keys()][selectedDayIdx];
        const dailyData = this.state.covidDataGroupedByDay.get(dayKey);

        const dailyDict = {};
        dailyData.forEach(e => {
            dailyDict[e["Municipality_code"]] = e[DAILY_REPORTED_FIELD_MA];
        });

        d3.select('#svg-nl-map')
            .selectAll("#path-group path")
            .transition()
            .duration(ANIMATION_DELAY)
            .ease(d3.easePoly)
            .attr("fill", e => {
                const currentReported = dailyDict[areaCodeToGmCode(e.properties.areaCode)];
                if (currentReported === undefined) {
                    return "rgb(170, 170, 170)";
                }

                if (currentReported === null) {
                    return "rgb(255, 255, 255)";
                }

                return this.state.colorScale(currentReported);
            });
    }; // end redraw()

    componentDidUpdate() {
        if (this.state.selectedDayNr >= this.state.numberOfDays) {
            this.setState({
                selectedDayNr: 0,
                isPlaying: false
            });
        }

        if (this.state.isPlaying) {
            if (this.state.selectedDayNr < this.state.numberOfDays - 1) {
                setTimeout(() => {
                    this.setState({
                        selectedDayNr: this.state.selectedDayNr + 1
                    });
                }, 40);
            }
        }
    }


    render() {
        const isRenderable = (this.state.populationData !== null) &&
            (this.state.nlGeoJson !== null) &&
            (this.state.covidDataGroupedByDay !== null);

        if (isRenderable) {
            this.redrawDay(this.state.selectedDayNr);
        }

        return (
            <div
                id="chartArea"
                className="m-5 w-75 col-12 justify-content-center"
            >
                <p><Badge bg="primary">{
                    this.state.covidDataGroupedByDay === null ? "" :
                        [...this.state.covidDataGroupedByDay.keys()][this.state.selectedDayNr]
                }
                </Badge></p>
                {
                    this.state.covidDataGroupedByDay === null ?
                        <div style={{ "height": "90%" }}>
                            <Spinner
                                animation="border"
                                role="status"
                                size="lg"
                                variant="primary"
                            >
                                <span className="visually-hidden">Loading...</span>
                            </Spinner>
                        </div> :
                        <div style={{ "visibility": "hidden" }}></div>
                }
                <svg id='svg-nl-map' className="m-1 w-75 col-12">
                </svg>
                <br />
                <div className='m-5 w-50 col-12 justify-content-center'>
                    <RangeSlider
                        style={{ align: "center" }}
                        min={0}
                        max={this.state.numberOfDays - 1}
                        step={1}
                        value={this.state.selectedDayNr}
                        tooltipPlacement={"top"}
                        tooltip='auto'
                        aria-label="Calendar day"
                        tooltipLabel={i => {
                            if (this.state.covidDataGroupedByDay === null) {
                                return null;
                            }
                            else {
                                return [...this.state.covidDataGroupedByDay.keys()][i];
                            }
                        }}
                        size={'sm'}
                        onChange={(changeEvent) => {
                            this.setState({
                                selectedDayNr: parseInt(changeEvent.target.value),
                                isPlaying: false
                            });
                        }}
                    />
                    <br />
                    <Button
                        className='m-1'
                        onClick={() => {
                            this.setState({
                                selectedDayNr: 0,
                                isPlaying: false
                            });
                        }}
                    >
                        Reset
                    </Button>
                    <Button
                        className='m-1'
                        onClick={() => {
                            this.setState({
                                selectedDayNr: (this.state.selectedDayNr - 1) % this.state.numberOfDays,
                                isPlaying: false
                            });
                        }}
                    >
                        Previous
                    </Button>
                    <Button
                        className='m-1'
                        onClick={() => {
                            this.setState({
                                isPlaying: !this.state.isPlaying
                            });
                        }}
                    >
                        Play/Pause
                    </Button>
                    <Button
                        className='m-1'
                        onClick={() => {
                            this.setState({
                                selectedDayNr: this.state.selectedDayNr + 1,
                                isPlaying: false
                            });
                        }}
                    >
                        Next
                    </Button>
                </div>
            </div>

        );
    }
}

export default App;
