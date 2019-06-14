const DEFAULT_GET_TAGS = (() => ({}));

/**
 * @function getTagsFunction
 * @returns {Object} tags objects
 *
 * Receives the arguments passed to the step and return extra
 * tags to associate to the span of the step
 */

/**
 * @typedef {Object} StepDefinition
 *
 * @property {boolean} [isTraceableStep=false] Whether step span should be send as first argument of the handler
 * @property {function} handler Whaterfall step function
 * @property {string} name Step names
 * @property {getTagsFunction} getTags Function that returns tags, it receives the same args as the step
 */

/**
 * It takes a series of step definitions, where each step handler is thought to be run sequentially
 * in a waterfall (as in async.waterfall).
 *
 * It adds tracing instrumentation to each step
 * and returns an array of handlers what would trace the full sequence, the handlers
 * will be completely unaware of the tracing code unlless you use
 * `isTraceableStep` definition option.
 *
 * `isTraceableStep` options allows the request handler to receive the
 * step span as the first argument so you can trace deeper.
 */
module.exports = (tracer, logger) => {

  function buildStartStep(getSequenceContext) {
    return function decorateStep(/*...args, done*/) {
      const done = arguments[arguments.length - 1];
      const contextArgs = Array.from(arguments).slice(0, -1);

      let sequenceSpan;
      let sequenceTags;
      let parentSpan;
      let sequenceName;

      try {
        const context = getSequenceContext.apply(contextArgs);
        sequenceName = context.operationName;
        sequenceTags = context.tags;
        parentSpan = context.parentSpan;

        sequenceSpan = tracer.startSpan(sequenceName, { childOf: parentSpan });

        if (sequenceTags !== null && typeof sequenceTags === 'object') {
          sequenceSpan.addTags(sequenceTags);
        } else {
          sequenceTags = {};
        }
      } catch (err) {
        // Ignore this error
        sequenceSpan = null;
        sequenceTags = {};
      }

      const tracerCtx = { sequenceName, sequenceTags, sequenceSpan, parentSpan: sequenceSpan };

      // Call next waterfall with the noError + tracerContext + originalArgs
      const doneArgs = [null, tracerCtx].concat(contextArgs);

      done.apply(this, doneArgs);
    };
  }

  function decorateStep(options) {
    options = options || {};

    const stepFn = options.handler;
    const name = options.name || stepFn.name;
    const isTraceableStep = options.isTraceableStep;
    const getTags = typeof options.getTags === 'function' ? options.getTags : (() => ({}));

    return function wrappedStepFunction(traceCtx /*, ...args */) {
      const stepsArgs = Array.from(arguments).slice(1);

      try {
        const sequenceSpan = traceCtx.sequenceSpan;
        const parentSpan = traceCtx.parentSpan;
        const sequenceTags = traceCtx.sequenceTags;
        const sequenceName = traceCtx.sequenceName;

        // If isTraceableStep = true we pass the span
        // to the next step
        if (isTraceableStep) {
          stepsArgs.unshift(parentSpan);
        }

        const callback = stepsArgs[stepsArgs.length - 1];

        const span = tracer.startSpan(name, { childOf: parentSpan });
        span.addTags(sequenceTags);

        try {
          // Prevent a full failure just because not being able to get
          // tags for an step
          const spanTags = getTags.apply(this, stepsArgs.slice(0, -1));

          if (spanTags !== null && typeof spanTags === 'object') {
            span.addTags(spanTags);
          }
        } catch (err) {
          logger.warn({
            log_type: 'waterfall_tracer_error',
            err,
            step: name,
            sequenceName
          }, `Failed getting tags for ${sequenceName}, step ${name}`);
        }

        // Finish span in the callback
        stepsArgs[stepsArgs.length - 1] = function doneCallback(err) {
          if (err) {
            span.setTag(tracer.Tags.ERROR, true);
            span.setTag(tracer.Tags.SAMPLING_PRIORITY, 1);
          }

          span.finish();

          const contextArgs = Array.from(arguments);
          const error = contextArgs.shift();
          const doneCallbackArgs = [
            error,
            { sequenceTags, sequenceSpan, parentSpan: span }
          ].concat(contextArgs);

          callback.apply(this, doneCallbackArgs);
        };
      } catch (err) {
        // Defensive there is no much to do with this error
        logger.warn({
          log_type: 'waterfall_tracer_error',
          err
        }, `Error tracing step`);
      }

      stepFn.apply(this, stepsArgs);
    };
  }

  function finishStep(traceCtx) {
    const args = Array.from(arguments).slice(1, -1);
    const done = arguments[arguments.length - 1];

    try {
      if (traceCtx.sequenceSpan) {
        traceCtx.sequenceSpan.finish();
      }
    } catch (err) {
      // Defensive there is no much to do with this error
      logger.warn({
        log_type: 'waterfall_tracer_error',
        err
      }, `Error finishing waterfall tracing`);
    }

    args.unshift(null); // If we are running this callback then it means there was no error

    done.apply(this, args);
  }

  /**
   * @function decorateSteps
   * @param {function} getSequenceContext
   * @param {Array<StepDefinition>} definitions
   */
  function decorateSteps(getSequenceContext, definitions) {
    const startSequenceStep = buildStartStep(getSequenceContext);

    const baseSteps = definitions.map((definition) => {
      return decorateStep({
        getTags: definition.getTags || DEFAULT_GET_TAGS,
        handler: definition.handler,
        name: definition.name,
        isTraceableStep: definition.isTraceableStep
      });
    });

    return [ startSequenceStep ]
      .concat(baseSteps)
      .concat([ finishStep ]);
  }

  return {
    decorateSteps
  };
};

