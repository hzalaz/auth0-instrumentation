var stubs = require('./lib/stubs');
var Logger = require('./lib/logger');
var ErrorReporter = require('./lib/error_reporter');
var Metrics = require('./lib/metrics');
var Profiler = require('./lib/profiler');
var Tracer = require('./lib/tracer');
var traceWaterfallSteps = require('./lib/trace_waterfall_steps');

/**
 * @typedef {Object} InstrumentationParams
 *
 * @property {function} isTracerEnabled Determines whether tracer is enabled and allows
 * to dynamically turn it on / off (e.g. using a flag)
 * @property {function} isEnabled Deprecated: same as `isTracerEnabled`, use `isTracerEnabled`
 * instead
 * @property {string} fileRotationSignal Process signal to use to rotate the log file
 */

module.exports = {
  logger: stubs.logger,
  errorReporter: stubs.errorReporter,
  metrics: stubs.metrics,
  profiler: stubs.profiler,
  tracer: stubs.tracer,
  initialized: false,

  /**
   * Initialize the instrumentation agent
   *
   * @param {Object} pkg Package configuration in general taken from package.jsons
   * @param {Object} env Environment configuration for instrumentation
   * @param {Object} serializers Logger serializers
   * @param {InstrumentationParams} params Instrumentation parametrs
   */
  init: function(pkg, env, serializers, params) {
    if (this.initialized) { return; }

    this.logger = Logger(pkg, env, serializers);
    this.errorReporter = ErrorReporter(pkg, env);
    this.metrics = Metrics(pkg, env);
    this.profiler = new Profiler(this, pkg, env);
    this.tracer = Tracer(this, pkg, env, {
      // Using params.isEnabled should be consider legacy since it is a bit
      // misleading because it only applies to tracing
      isEnabled: params && (params.isTracerEnabled || params.isEnabled),
      logger: this.logger
    });
    this.initialized = true;

    if (params && params.fileRotationSignal && env.LOG_FILE) {
      process.on(params.fileRotationSignal, () => {
        this.logger.reopenFileStreams();
        this.logger.info('The log file has been rotated.');
      });
    }
  },

  utils: {
    tracing: {
      traceWaterfallSteps
    }
  }
};
