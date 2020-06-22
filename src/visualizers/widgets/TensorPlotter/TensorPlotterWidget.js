/*globals define, $ */

define([
    'deepforge/viz/widgets/WidgetWithCompute',
    'deepforge/storage/index',
    'deepforge/compute/interactive/session-with-queue',
    'widgets/PlotlyGraph/lib/plotly.min',
    './PlotEditor',
    './ArtifactLoader',
    'underscore',
    'text!./files/explorer_helpers.py',
    'css!./styles/TensorPlotterWidget.css',
], function (
    WidgetWithCompute,
    Storage,
    Session,
    Plotly,
    PlotEditor,
    ArtifactLoader,
    _,
    HELPERS_PY,
) {
    'use strict';

    const WIDGET_CLASS = 'dataset-explorer';

    class TensorPlotterWidget extends WidgetWithCompute {
        constructor(logger, container) {
            super(container);
            this._logger = logger.fork('Widget');

            this.session = null;
            this.$el = container;
            this.$el.addClass(WIDGET_CLASS);
            const row = $('<div>', {class: 'row', style: 'height: 100%'});
            this.$el.append(row);

            this.$plot = $('<div>', {class: 'plot col-9', style: 'height: 100%'});

            const rightPanel = $('<div>', {class: 'col-3'});
            const $plotEditor = $('<div>', {class: 'plot-editor'});
            this.plotEditor = new PlotEditor($plotEditor);
            this.plotEditor.on('update', plotData => {
                this.updatePlot(plotData);
            });
            this.metadata = [];
            const $artifactLoader = $('<div>', {class: 'artifact-loader'});
            this.artifactLoader = new ArtifactLoader($artifactLoader);
            this.artifactLoader.getConfigDialog = () => this.getConfigDialog();
            this.artifactLoader.on('load', async desc => {
                this.metadata.push(await this.getMetadata(desc));
                this.plotEditor.set({metadata: this.metadata});
            });

            row.append(this.$plot);
            rightPanel.append($plotEditor);
            rightPanel.append($artifactLoader);
            row.append(rightPanel);

            this._logger.debug('ctor finished');
        }

        async createInteractiveSession(computeId, config) {
            this.session = await Session.new(computeId, config);
            this.initSession();
            this.artifactLoader.session = this.session;
        }

        async getAuthenticationConfig (dataInfo) {
            const {backend} = dataInfo;
            const metadata = Storage.getStorageMetadata(backend);
            metadata.configStructure = metadata.configStructure
                .filter(option => option.isAuth);

            if (metadata.configStructure.length) {
                const configDialog = this.getConfigDialog();
                const title = `Authenticate with ${metadata.name}`;
                const iconClass = `glyphicon glyphicon-download-alt`;
                const config = await configDialog.show(metadata, {title, iconClass});

                return config[backend];
            }
        }

        async initSession () {
            await this.session.whenConnected();
            // TODO: Prepend initialization code?
            await this.session.addFile('utils/explorer_helpers.py', HELPERS_PY);
        }

        async getPoints (lineInfo) {
            const {data, dataSlice=''} = lineInfo;
            const [artifactName] = data.split('[');
            const command = [
                `from artifacts.${artifactName} import data as ${artifactName}`,
                `from utils.explorer_helpers import tolist`,
                'import json',
                `print(json.dumps(tolist(${data}${dataSlice})))`
            ].join(';');
            const {stdout} = await this.session.exec(`python -c '${command}'`);  // TODO: Add error handling
            return JSON.parse(stdout);
        }

        async getColorValues (lineInfo) {
            const {colorData, colorDataSlice='', startColor, endColor} = lineInfo;
            const [artifactName] = colorData.split('[');
            const command = [
                `from artifacts.${artifactName} import data as ${artifactName}`,
                `from utils.explorer_helpers import tolist, scale_colors`,
                'import json',
                `data = ${colorData}${colorDataSlice}`,
                `colors = scale_colors(data, "${startColor}", "${endColor}")`,
                `print(json.dumps(colors))`
            ].join(';');
            const {stdout, stderr} = await this.session.exec(`python -c '${command}'`);  // TODO: Add error handling
            if (stderr) console.log('stderr:', stderr);
            return JSON.parse(stdout);
        }

        async getMetadata (desc) {
            const {name} = desc;
            const pyName = name.replace(/\..*$/, '');
            const command = [
                `from artifacts.${pyName} import data`,
                'from utils.explorer_helpers import metadata',
                'import json',
                `print(json.dumps(metadata("${name}", data)))`
            ].join(';');
            const {stdout, stderr} = await this.session.exec(`python -c '${command}'`);  // TODO: Add error handling
            if (stderr) console.log('stderr:', stderr);
            return JSON.parse(stdout);
        }

        async getPlotData (line) {
            const {shape} = line;
            const dim = shape[1];
            const dataDims = dim ? dim : 1;
            let x,y,z;
            let plotData = null;
            switch(dataDims) {
            case 1:
                plotData = {
                    y: await this.getPoints(line),
                    boxpoints: 'all',
                    jitter: 0.3,
                    pointpos: -1.8,
                    name: line.name,
                    type: 'box'
                };
                break;

            case 2:
                [x, y] = _.unzip(await this.getPoints(line));
                plotData = {
                    name: line.name,
                    mode: 'markers',  // lines
                    type: 'scatter',
                    x, y
                };
                break;

            case 3:
                [x, y, z] = _.unzip(await this.getPoints(line));
                plotData = {
                    name: line.name,
                    mode: 'markers',  // lines
                    type: 'scatter3d',
                    x, y, z
                };
                break;
            }
            await this.addPlotColor(plotData, line);
            return plotData;
        }

        async addPlotColor (plotData, line) {
            if (line.colorType === 'uniform') {
                plotData.marker = {
                    color: `#${line.uniformColor}`,
                    size: 2,
                };
            } else {
                const colors = await this.getColorValues(line);
                plotData.marker = {
                    color: colors,
                    size: 2
                };
            }
            return plotData;
        }

        onWidgetContainerResize (/*width, height*/) {
            this._logger.debug('Widget is resizing...');
        }

        defaultLayout(desc) {
            const title = `Distribution of Labels for ${desc.name}`;
            return {title};
        }

        async updatePlot (figureData) {
            const layout = _.pick(figureData, ['title', 'xaxis', 'yaxis']);
            if (layout.xaxis) {
                layout.xaxis = {title: layout.xaxis};
            }
            if (layout.yaxis) {
                layout.yaxis = {title: layout.yaxis};
            }
            const data = [];
            for (let i = 0; i < figureData.data.length; i++) {
                data.push(await this.getPlotData(figureData.data[i]));
            }
            Plotly.newPlot(this.$plot[0], data, layout);
        }

        // Adding/Removing/Updating items
        async addNode (desc) {
            this.artifactLoader.register(desc);
            Plotly.react(this.$plot[0]);  // FIXME
        }

        removeNode (gmeId) {
            this.artifactLoader.unregister(gmeId);
        }

        updateNode (/*desc*/) {
            // TODO: handle node changes, etc
        }

        /* * * * * * * * Visualizer life cycle callbacks * * * * * * * */
        destroy () {
            Plotly.purge(this.$plot[0]);
            this.session.close();
        }

        onActivate () {
            this._logger.debug('TensorPlotterWidget has been activated');
        }

        onDeactivate () {
            this._logger.debug('TensorPlotterWidget has been deactivated');
        }
    }

    return TensorPlotterWidget;
});