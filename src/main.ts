import { Command, Helper, OptionsHelper } from '@dojo/interfaces/cli';
import * as express from 'express';
import * as logUpdate from 'log-update';
import * as ora from 'ora';
import * as webpack from 'webpack';

import devConfigFactory from './dev.config';
import testConfigFactory from './test.config';
import distConfigFactory from './dist.config';
import logger from './logger';

const fixMultipleWatchTrigger = require('webpack-mild-compile');
const hotMiddleware = require('webpack-hot-middleware');
const webpackMiddleware = require('webpack-dev-middleware');

function createCompiler(config: webpack.Configuration) {
	const compiler = webpack(config);
	fixMultipleWatchTrigger(compiler);
	return compiler;
}

function createWatchCompiler(config: webpack.Configuration) {
	const compiler = createCompiler(config);
	const spinner = ora('building').start();
	compiler.plugin('invalid', () => {
		logUpdate('');
		spinner.start();
	});
	compiler.plugin('done', () => {
		spinner.stop();
	});
	return compiler;
}

function build(config: webpack.Configuration) {
	const compiler = createCompiler(config);
	const spinner = ora('building').start();
	return new Promise((resolve, reject) => {
		compiler.run((err, stats) => {
			spinner.stop();
			if (err) {
				reject(err);
			}
			if (stats) {
				logger(stats.toJson(), config);
			}
			resolve();
		});
	});
}

function fileWatch(config: webpack.Configuration, args: any): Promise<void> {
	const compiler = createWatchCompiler(config);

	return new Promise<void>((resolve, reject) => {
		const watchOptions = config.watchOptions as webpack.Compiler.WatchOptions;
		compiler.watch(watchOptions, (err, stats) => {
			if (err) {
				reject(err);
			}
			if (stats) {
				const runningMessage = args.serve ? `Listening on port ${args.port}` : 'watching...';
				logger(stats.toJson(), config, runningMessage);
			}
			resolve();
		});
	});
}

function memoryWatch(config: webpack.Configuration, args: any, app: express.Application): Promise<void> {
	const entry = config.entry as any;
	const plugins = config.plugins as webpack.Plugin[];
	const timeout = 20 * 1000;

	plugins.push(new webpack.HotModuleReplacementPlugin(), new webpack.NoEmitOnErrorsPlugin());
	Object.keys(entry).forEach(name => {
		entry[name].unshift(`webpack-hot-middleware/client?timeout=${timeout}&reload=true`);
	});

	const watchOptions = config.watchOptions as webpack.Compiler.WatchOptions;
	const compiler = createWatchCompiler(config);

	compiler.plugin('done', stats => {
		logger(stats.toJson(), config, `Listening on port ${args.port}...`);
	});

	app.use(
		webpackMiddleware(compiler, {
			logLevel: 'silent',
			noInfo: true,
			publicPath: '/',
			watchOptions
		}),
		hotMiddleware(compiler, {
			heartbeat: timeout / 2
		})
	);

	return Promise.resolve();
}

function serve(config: webpack.Configuration, args: any): Promise<void> {
	const app = express();

	if (args.watch !== 'memory') {
		const outputDir = (config.output && config.output.path) || process.cwd();
		app.use(express.static(outputDir));
	}

	return Promise.resolve()
		.then(() => {
			if (args.watch === 'memory' && args.mode === 'dev') {
				return memoryWatch(config, args, app);
			} else if (args.watch) {
				if (args.watch === 'memory') {
					console.warn('Memory watch requires `--mode=dev`. Using file watch instead...');
				}
				return fileWatch(config, args);
			}
		})
		.then(() => {
			return new Promise<void>((resolve, reject) => {
				app.listen(args.port, (error: Error) => {
					if (error) {
						reject(error);
					} else {
						resolve();
					}
				});
			});
		});
}

const command: Command = {
	group: 'build',
	name: 'app',
	description: 'create a build of your application',
	register(options: OptionsHelper) {
		options('mode', {
			describe: 'the output mode',
			alias: 'm',
			default: 'dist',
			choices: ['dist', 'dev', 'test']
		});

		options('watch', {
			describe: 'watch for file changes: "memory" (dev mode only) or "file" (all modes; default)',
			alias: 'w'
		});

		options('serve', {
			describe: 'start a webserver',
			alias: 's',
			type: 'boolean'
		});

		options('port', {
			describe: 'used in conjunction with the serve option to specify the webserver port',
			alias: 'p',
			default: 9999,
			type: 'number'
		});
	},
	run(helper: Helper, args: any) {
		console.log = () => {};
		const rc = helper.configuration.get() || {};
		let config: webpack.Configuration;
		if (args.mode === 'dev') {
			config = devConfigFactory(rc);
		} else if (args.mode === 'test') {
			config = testConfigFactory(rc);
		} else {
			config = distConfigFactory(rc);
		}

		if (args.serve) {
			return serve(config, args);
		}

		if (args.watch) {
			if (args.watch === 'memory') {
				console.warn('Memory watch requires the dev server. Using file watch instead...');
			}
			return fileWatch(config, args);
		}

		return build(config);
	}
};
export default command;
