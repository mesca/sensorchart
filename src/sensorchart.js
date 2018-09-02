/**
 * @file A blazing fast charting library for streaming data.
 * @author Pierre Clisson <pierre@clisson.net>
 */

'use strict';

// Dependencies
const line2d = require('regl-line2d');


/**
 * A set of static utilities
 *
 * @namespace Helpers
 */
const Helpers = {

    /**
     * Converts an hexadecimal string color to a vec4 color suitable for WebGL
     *
     * @param {string} color - the hex color
     * @return {array} the vec4 color
     */
    hexToVec4: function(color) {
        let matches = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(color);
        return matches ? [
            parseInt(matches[1], 16) / 255,
            parseInt(matches[2], 16) / 255,
            parseInt(matches[3], 16) / 255,
            1
        ] : color;
    }

}


/**
 * Handle line rendering
 */
class Chart {

    /**
     * Initialize the chart
     *
     * @param {Element} canvas - the HTML canvas element
     * @param {Object} options
     * @param {number} options.scale - milliseconds per pixel
     * @param {number} options.offset - the time offset, in milliseconds
     * @param {boolean} options.stack - stack multiple series
     * @param {string} options.background - the background color
     * @param {string} options.foreground - the grid color
     * @param {string} options.thickness - the grid thickness
     * @param {number} options.sections - the number of vertical sections in the grid
     * @param {number} options.tick - the tick marker, in milliseconds
     */
    constructor(canvas, options = {}) {
        let default_options = {
            min: -1,
            max: 1,
            scale: 20,
            offset: -150,
            background: '#E8E8E8',
            foreground: '#808080',
            thickness: 1,
            sections: 2,
            tick: 1000
        };
        this.options = Object.assign(default_options, options);
        this.options.background = Helpers.hexToVec4(this.options.background);
        this.options.foreground = Helpers.hexToVec4(this.options.foreground);
        this.canvas = canvas;
        this.context = this.canvas.getContext('webgl');
        this.regl = createREGL({
            gl: this.context,
            extensions: 'angle_instanced_arrays'
        });
        this.lines = line2d(this.regl);
        this.series = [];
    }

    /**
     * Add a series to the chart
     *
     * @param {Series} series - the series object
     */
    addSeries(series) {
        this.series.push(series);
    }

    /**
     * Render the chart
     */
    render(timestamp) {

        // Resize the canvas
        let width = this.canvas.clientWidth;
        let height = this.canvas.clientHeight
        if (this.canvas.width != width || this.canvas.height != height) {
          this.canvas.width = width;
          this.canvas.height = height;
        }
        let viewport = [0, 0, width, height];

        // Adjust the timestamp
        timestamp += this.options.offset;

        // Get the first and last displayed timestamps
        let last = timestamp;
        let first = last - width * this.options.scale;

        // Hold line objects
        let lines = [];

        // Clear the canvas
        this.regl.clear({color: this.options.background, depth: 1});

        // Grid
        // Horizontal lines
        let sections = this.options.sections;
        if (this.options.stack) sections *= this.series.length;
        let crisp = this.options.thickness % 2 === 0 ? false : true;
        let intervalY = Math.round(height / sections);
        for (let i = 1; i < sections; i++) {
            let y = intervalY * i;
            //if (crisp && y % 2 === 0) y += .5;
            if (crisp) y += .5;
            let viewport = [0, 0, width, height];
            lines.push({
                thickness: this.options.thickness,
                color: this.options.foreground,
                points: [0, y, width, y],
                close: false,
                viewport: viewport,
                range: viewport
            });
        }
        // Vertical lines
        let f = timestamp - width * this.options.scale;
        let l = timestamp - (timestamp % this.options.tick);
        for (let i = l; i >= f; i -= this.options.tick) {
            let x = width - (timestamp - i) / this.options.scale;
            lines.push({
                thickness: this.options.thickness,
                color: this.options.foreground,
                points: [x, 0, x, height],
                close: false,
                viewport: viewport,
                range: viewport
            });
        }

        // Stacked series
        if (this.options.stack) {
            var seriesHeight = height / this.series.length;
            var i = 0;
        }

        // For each series
        for (let series of this.series) {

            // Stacked series
            if (this.options.stack) {
                i++;
                viewport = {x: 0, y: height - seriesHeight * i, w: width, h: seriesHeight};
            }

            // Remove old samples
            series.removeOlderThan(first);

            // Add a line
            lines.push({
                thickness: series.options.thickness,
                color: series.options.color,
                points: series.data,
                close: false,
                viewport: viewport,
                range: [first, series.options.min, last, series.options.max]
            });

        }

        // Render
        this.lines.render(lines);

    }

}


/**
 * Hold time series data and options
 */
class Series {

    /**
     * Initialize the time series
     *
     * @param {Object} options
     * @param {number} options.min - the minimum value
     * @param {number} options.max - the maximum value
     * @param {string} options.color - the line color
     * @param {number} options.thickness - the line thickness
     */
    constructor(options = {}) {
        let default_options = {
            min: -1,
            max: 1,
            color: 'black',
            thickness: 2
        };
        this.options = Object.assign(default_options, options);
        this.data = [];
    }

    /**
     * Append a sample to the chart
     *
     * @param {float} time - the timestamp, in milliseconds
     * @param {number} value - the value
     */
    append(time, value) {
        // TODO: push multiple
        this.data.push([time, value]);
    }

    /**
     * Remove old samples
     *
     * @param {number} timestamp - milliseconds
     */
    removeOlderThan(timestamp) {
        for (var i = 0, l = this.data.length; i < l; i++) {
            if (this.data[i][0] >= timestamp) break;
        }
        if (i > 0) i--; // keep one point outside of the chart
        this.data = this.data.slice(i);
    }

}


/**
 * Render charts at 60 FPS
 */
class Scheduler {

    /**
     * Initialize the scheduler
     *
     * @param {callback} callback - an optional callback function to receive FPS values
     */
    constructor(callback) {
        this.callback = callback;
        this.charts = [];
    }

    /**
     * Add a chart to the scheduler
     *
     * @param {SensorChart} chart - the chart object
     */
    addChart(chart) {
        this.charts.push(chart);
    }

    /**
     * Start the scheduler
     */
    start() {
        this.loop = true;
        this.last = 0;
        this.frame();
    }

    /**
     * Stop the scheduler
     */
    stop() {
        this.loop = false;
    }

    /**
     * Render all charts
     */
    frame() {
        var now = Date.now();
        var fps = 1000 / (now - this.last);
        this.last = now;
        if (this.callback) this.callback(fps);
        for (let chart of this.charts) {
            chart.render(now);
        }
        if (this.loop) {
            window.requestAnimationFrame(this.frame.bind(this));
        }
    }

}