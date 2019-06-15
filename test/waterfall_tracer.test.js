'use strict';

const assert = require('assert');
const buildWaterfallTracer = require('../lib/watefall_tracer');
const async = require('async');


describe('waterfall tracer', function() {
  class StubLogger {
    warn() {

    }
  }

  class StubSpan {
    constructor(operation) {
      this.operation = operation;
      this.finished = true;
      this.childs = [];
      this.tags = {};
    }

    addChild(childSpan) {
      this.childs.push(childSpan);
    }

    addTags(tags) {
      this.tags = Object.assign({}, this.tags, tags);
    }

    setTag(tag, value) {
      this.tags[tag] = value;
    }

    finish() {
      this.finished = true;
    }
  }

  class TracerStub {
    constructor() {
      this.rootSpans = new Set();

      this.Tags = {
        ERROR: 'ERROR',
        SAMPLING_PRIORITY: 'SAMPLING_PRIORITY'
      };
    }

    startSpan(operation, options) {
      options = options || {};

      const span = new StubSpan(operation);

      if (options.childOf) {
        options.childOf.addChild(span);
      } else {
        this.rootSpans.add(span);
      }

      return span;
    }

    getFullTrace() {
      return Array.from(this.rootSpans);
    }
  }

  describe('decorateSteps', function() {
    const namedDefinitions = {
      noArgsBaseStep0: {
        handler: function noArgsBaseStep0(cb) {
          cb(null, '1.arg1', '1.arg2', '1.arg3');
        },
        getTags: function() {
          return {
            '1.noArgsBaseStep0': '1.value',
            '2.noArgsBaseStep0': '2.value'
          };
        }
      },

      baseStep1: {
        handler: function baseStep1(arg1, arg2, arg3, cb) {
          assert.equal(arg1, '1.arg1');
          assert.equal(arg2, '1.arg2');
          assert.equal(arg3, '1.arg3');

          cb(null, '1.res1', '1.res2', '1.res3', '1.res4');
        },
        getTags: function(arg1, arg2, arg3) {
          assert.equal(arg1, '1.arg1');
          assert.equal(arg2, '1.arg2');
          assert.equal(arg3, '1.arg3');

          return {
            '1.baseStep1': '1.value',
            '2.baseStep1': '2.value'
          };
        }
      },

      baseStep2: {
        handler: function baseStep2(arg1, arg2, arg3, arg4, cb) {
          assert.equal(arg1, '1.res1');
          assert.equal(arg2, '1.res2');
          assert.equal(arg3, '1.res3');
          assert.equal(arg4, '1.res4');

          cb(null, '2.res1', '2.res2');
        },
        getTags: function(arg1, arg2, arg3, arg4) {
          assert.equal(arg1, '1.res1');
          assert.equal(arg2, '1.res2');
          assert.equal(arg3, '1.res3');
          assert.equal(arg4, '1.res4');

          return {
            '1.baseStep2': '1.value',
            '2.baseStep2': '2.value'
          };
        }
      },

      baseStep3: {
        handler: function baseStep3(arg1, arg2, cb) {
          assert.equal(arg1, '2.res1');
          assert.equal(arg2, '2.res2');

          cb(null, '3.res1', '3.res2', '3.res3');
        },
        getTags: function(arg1, arg2) {
          assert.equal(arg1, '2.res1');
          assert.equal(arg2, '2.res2');

          return {
            '1.baseStep3': '1.value',
            '2.baseStep3': '2.value'
          };
        }
      },

      traceableBaseStep3: {
        handler: function baseStep3(span, arg1, arg2, cb) {
          assert.ok(span instanceof StubSpan);

          assert.equal(arg1, '2.res1');
          assert.equal(arg2, '2.res2');

          cb(null, '3.res1', '3.res2', '3.res3');
        },
        getTags: function(arg1, arg2) {
          assert.equal(arg1, '2.res1');
          assert.equal(arg2, '2.res2');

          return {
            '1.baseStep3': '1.value',
            '2.baseStep3': '2.value'
          };
        },
        isTraceableStep: true
      },

      errorStep2: {
        handler: function baseStep2(arg1, arg2, arg3, arg4, cb) {
          assert.equal(arg1, '1.res1');
          assert.equal(arg2, '1.res2');
          assert.equal(arg3, '1.res3');
          assert.equal(arg4, '1.res4');

          cb(new Error('myError'));
        },
        getTags: function(arg1, arg2, arg3, arg4) {
          assert.equal(arg1, '1.res1');
          assert.equal(arg2, '1.res2');
          assert.equal(arg3, '1.res3');
          assert.equal(arg4, '1.res4');

          return {
            '1.errorStep2': '1.value',
            '2.errorStep2': '2.value'
          };
        }
      }
    };

    describe('handling the whole set of steps in the waterfall', () => {
      const stepDefinitions = [
        {
          handler: namedDefinitions.noArgsBaseStep0.handler,
          isTraceableStep: false,
          name: 'noArgsBaseStep0',
          getTags: namedDefinitions.noArgsBaseStep0.getTags
        },
        {
          handler: namedDefinitions.baseStep1.handler,
          isTraceableStep: false,
          name: 'baseStep1',
          getTags: namedDefinitions.baseStep1.getTags
        },
        {
          handler: namedDefinitions.baseStep2.handler,
          isTraceableStep: false,
          name: 'baseStep2',
          getTags: namedDefinitions.baseStep2.getTags,
        },
        {
          handler: namedDefinitions.baseStep3.handler,
          isTraceableStep: false,
          name: 'baseStep3',
          getTags: namedDefinitions.baseStep3.getTags
        },
      ];

      const buildGetSequenceContext = (tracer) => function getSequenceContext() {
        return {
          operationName: 'fullSequence',
          tags: {
            'root.tag.1': 'root.value.1',
            'root.tag.2': 'root.value.2',
          },
          parentSpan: tracer.startSpan('rootSpan')
        };
      };

      it('calls each function with the correct arguments', (done) => {
        const tracer = new TracerStub();
        const waterfallTracer = buildWaterfallTracer(tracer, new StubLogger());
        const steps = waterfallTracer.decorateSteps(buildGetSequenceContext(tracer), stepDefinitions);

        async.waterfall(steps, (err, arg1, arg2, arg3) => {
          assert.ifError(err);

          assert.equal(arg1, '3.res1');
          assert.equal(arg2, '3.res2');
          assert.equal(arg3, '3.res3');

          done();
        });
      });

      it('traces each step correctly', (done) => {
        const expectedTrace = [
          {
            "operation": "rootSpan",
            "finished": true,
            "childs": [
              {
                "operation": "fullSequence",
                "finished": true,
                "childs": [
                  {
                    "operation": "noArgsBaseStep0",
                    "finished": true,
                    "childs": [
                      {
                        "operation": "baseStep1",
                        "finished": true,
                        "childs": [
                          {
                            "operation": "baseStep2",
                            "finished": true,
                            "childs": [
                              {
                                "operation": "baseStep3",
                                "finished": true,
                                "childs": [],
                                "tags": {
                                  "root.tag.1": "root.value.1",
                                  "root.tag.2": "root.value.2",
                                  "1.baseStep3": "1.value",
                                  "2.baseStep3": "2.value"
                                }
                              }
                            ],
                            "tags": {
                              "root.tag.1": "root.value.1",
                              "root.tag.2": "root.value.2",
                              "1.baseStep2": "1.value",
                              "2.baseStep2": "2.value"
                            }
                          }
                        ],
                        "tags": {
                          "root.tag.1": "root.value.1",
                          "root.tag.2": "root.value.2",
                          "1.baseStep1": "1.value",
                          "2.baseStep1": "2.value"
                        }
                      }
                    ],
                    "tags": {
                      "root.tag.1": "root.value.1",
                      "root.tag.2": "root.value.2",
                      "1.noArgsBaseStep0": "1.value",
                      "2.noArgsBaseStep0": "2.value"
                    }
                  }
                ],
                "tags": {
                  "root.tag.1": "root.value.1",
                  "root.tag.2": "root.value.2"
                }
              }
            ],
            "tags": {}
          }
        ];

        const tracer = new TracerStub();
        const waterfallTracer = buildWaterfallTracer(tracer, new StubLogger());
        const steps = waterfallTracer.decorateSteps(buildGetSequenceContext(tracer), stepDefinitions);

        async.waterfall(steps, (err) => {
          assert.ifError(err);

          assert.deepEqual(tracer.getFullTrace(), expectedTrace);

          done();
        });
      });

      describe('when it fails getting the tags for part of the sequence', () => {
        const stepDefinitions = [
          {
            handler: namedDefinitions.noArgsBaseStep0.handler,
            isTraceableStep: false,
            name: 'noArgsBaseStep0',
            getTags: namedDefinitions.noArgsBaseStep0.getTags
          },
          {
            handler: namedDefinitions.baseStep1.handler,
            isTraceableStep: false,
            name: 'baseStep1',
            getTags: namedDefinitions.baseStep1.getTags
          },
          {
            handler: namedDefinitions.baseStep2.handler,
            isTraceableStep: false,
            name: 'baseStep2',
            getTags: () => { throw new Error(); },
          },
          {
            handler: namedDefinitions.baseStep3.handler,
            isTraceableStep: false,
            name: 'baseStep3',
            getTags: namedDefinitions.baseStep3.getTags
          },
        ];

        const buildGetSequenceContext = (tracer) => function getSequenceContext() {
          return {
            operationName: 'fullSequence',
            tags: {
              'root.tag.1': 'root.value.1',
              'root.tag.2': 'root.value.2',
            },
            parentSpan: tracer.startSpan('rootSpan')
          };
        };

        it('does not fail', (done) => {
          const tracer = new TracerStub();
          const waterfallTracer = buildWaterfallTracer(tracer, new StubLogger());
          const steps = waterfallTracer.decorateSteps(buildGetSequenceContext(tracer), stepDefinitions);

          async.waterfall(steps, (err, arg1, arg2, arg3) => {
            assert.ifError(err);

            assert.equal(arg1, '3.res1');
            assert.equal(arg2, '3.res2');
            assert.equal(arg3, '3.res3');

            done();
          });
        });

        it('ignores tags for the step', (done) => {
          const expectedTrace = [
            {
              "operation": "rootSpan",
              "finished": true,
              "childs": [
                {
                  "operation": "fullSequence",
                  "finished": true,
                  "childs": [
                    {
                      "operation": "noArgsBaseStep0",
                      "finished": true,
                      "childs": [
                        {
                          "operation": "baseStep1",
                          "finished": true,
                          "childs": [
                            {
                              "operation": "baseStep2",
                              "finished": true,
                              "childs": [
                                {
                                  "operation": "baseStep3",
                                  "finished": true,
                                  "childs": [],
                                  "tags": {
                                    "root.tag.1": "root.value.1",
                                    "root.tag.2": "root.value.2",
                                    "1.baseStep3": "1.value",
                                    "2.baseStep3": "2.value"
                                  }
                                }
                              ],
                              "tags": {
                                "root.tag.1": "root.value.1",
                                "root.tag.2": "root.value.2",
                              }
                            }
                          ],
                          "tags": {
                            "root.tag.1": "root.value.1",
                            "root.tag.2": "root.value.2",
                            "1.baseStep1": "1.value",
                            "2.baseStep1": "2.value"
                          }
                        }
                      ],
                      "tags": {
                        "root.tag.1": "root.value.1",
                        "root.tag.2": "root.value.2",
                        "1.noArgsBaseStep0": "1.value",
                        "2.noArgsBaseStep0": "2.value"
                      }
                    }
                  ],
                  "tags": {
                    "root.tag.1": "root.value.1",
                    "root.tag.2": "root.value.2"
                  }
                }
              ],
              "tags": {}
            }
          ];

          const tracer = new TracerStub();
          const waterfallTracer = buildWaterfallTracer(tracer, new StubLogger());
          const steps = waterfallTracer.decorateSteps(buildGetSequenceContext(tracer), stepDefinitions);

          async.waterfall(steps, (err) => {
            assert.ifError(err);

            assert.deepEqual(tracer.getFullTrace(), expectedTrace);

            done();
          });
        });
      });

      describe('when it fails getting the context for the sequence', () => {
        it('does not fail', (done) => {
          const tracer = new TracerStub();
          const waterfallTracer = buildWaterfallTracer(tracer, new StubLogger());
          const steps = waterfallTracer.decorateSteps(() => {
            throw new Error();
          }, stepDefinitions);

          async.waterfall(steps, (err, arg1, arg2, arg3) => {
            assert.ifError(err);

            assert.equal(arg1, '3.res1');
            assert.equal(arg2, '3.res2');
            assert.equal(arg3, '3.res3');

            done();
          });
        });
      });

      describe('when one of the steps callbacks with an error', () => {
        const stepDefinitions = [
          {
            handler: namedDefinitions.noArgsBaseStep0.handler,
            isTraceableStep: false,
            name: 'noArgsBaseStep0',
            getTags: namedDefinitions.noArgsBaseStep0.getTags
          },
          {
            handler: namedDefinitions.baseStep1.handler,
            isTraceableStep: false,
            name: 'baseStep1',
            getTags: namedDefinitions.baseStep1.getTags
          },
          {
            handler: namedDefinitions.errorStep2.handler,
            isTraceableStep: false,
            name: 'errorStep2',
            getTags: namedDefinitions.errorStep2.getTags,
          },
          {
            handler: namedDefinitions.baseStep3.handler,
            isTraceableStep: false,
            name: 'baseStep3',
            getTags: namedDefinitions.baseStep3.getTags
          },
        ];

        const buildGetSequenceContext = (tracer) => function getSequenceContext() {
          return {
            operationName: 'fullSequence',
            tags: {
              'root.tag.1': 'root.value.1',
              'root.tag.2': 'root.value.2',
            },
            parentSpan: tracer.startSpan('rootSpan')
          };
        };

        it('calls each function with the correct arguments', (done) => {
          const tracer = new TracerStub();
          const waterfallTracer = buildWaterfallTracer(tracer, new StubLogger());
          const steps = waterfallTracer.decorateSteps(buildGetSequenceContext(tracer), stepDefinitions);

          async.waterfall(steps, (err) => {
            assert.equal(err.message, 'myError');

            done();
          });
        });

        it('traces each step correctly', (done) => {
          const expectedTrace = [
            {
              "operation": "rootSpan",
              "finished": true,
              "childs": [
                {
                  "operation": "fullSequence",
                  "finished": true,
                  "childs": [
                    {
                      "operation": "noArgsBaseStep0",
                      "finished": true,
                      "childs": [
                        {
                          "operation": "baseStep1",
                          "finished": true,
                          "childs": [
                            {
                              "operation": "errorStep2",
                              "finished": true,
                              "childs": [],
                              "tags": {
                                "root.tag.1": "root.value.1",
                                "root.tag.2": "root.value.2",
                                "1.errorStep2": "1.value",
                                "2.errorStep2": "2.value",
                                'ERROR': true,
                                'SAMPLING_PRIORITY': 1
                              }
                            }
                          ],
                          "tags": {
                            "root.tag.1": "root.value.1",
                            "root.tag.2": "root.value.2",
                            "1.baseStep1": "1.value",
                            "2.baseStep1": "2.value"
                          }
                        }
                      ],
                      "tags": {
                        "root.tag.1": "root.value.1",
                        "root.tag.2": "root.value.2",
                        "1.noArgsBaseStep0": "1.value",
                        "2.noArgsBaseStep0": "2.value"
                      }
                    }
                  ],
                  "tags": {
                    "root.tag.1": "root.value.1",
                    "root.tag.2": "root.value.2"
                  }
                }
              ],
              "tags": {}
            }
          ];

          const tracer = new TracerStub();
          const waterfallTracer = buildWaterfallTracer(tracer, new StubLogger());
          const steps = waterfallTracer.decorateSteps(buildGetSequenceContext(tracer), stepDefinitions);

          async.waterfall(steps, () => {
            assert.deepEqual(tracer.getFullTrace(), expectedTrace);

            done();
          });
        });
      });
    });

    describe('handling a subset of the waterfall', () => {
      const stepDefinitions = [
        {
          handler: namedDefinitions.baseStep1.handler,
          isTraceableStep: false,
          name: 'baseStep1',
          getTags: namedDefinitions.baseStep1.getTags
        },
        {
          handler: namedDefinitions.baseStep2.handler,
          isTraceableStep: false,
          name: 'baseStep2',
          getTags: namedDefinitions.baseStep2.getTags,
        }
      ];

      const buildGetSequenceContext = (tracer) => function getSequenceContext() {
        return {
          operationName: 'fullSequence',
          tags: {
            'root.tag.1': 'root.value.1',
            'root.tag.2': 'root.value.2',
          },
          parentSpan: tracer.startSpan('rootSpan')
        };
      };

      it('calls each function with the correct arguments', (done) => {
        const tracer = new TracerStub();
        const waterfallTracer = buildWaterfallTracer(tracer, new StubLogger());
        const steps = waterfallTracer.decorateSteps(buildGetSequenceContext(tracer), stepDefinitions);

        steps.unshift(namedDefinitions.noArgsBaseStep0.handler);
        steps.push(namedDefinitions.baseStep3.handler);

        async.waterfall(steps, (err, arg1, arg2, arg3) => {
          assert.ifError(err);

          assert.equal(arg1, '3.res1');
          assert.equal(arg2, '3.res2');
          assert.equal(arg3, '3.res3');

          done();
        });
      });

      it('traces each step correctly', (done) => {
        const expectedTrace = [
          {
            "operation": "rootSpan",
            "finished": true,
            "childs": [
              {
                "operation": "fullSequence",
                "finished": true,
                "childs": [
                  {
                    "operation": "baseStep1",
                    "finished": true,
                    "childs": [
                      {
                        "operation": "baseStep2",
                        "finished": true,
                        "childs": [],
                        "tags": {
                          "root.tag.1": "root.value.1",
                          "root.tag.2": "root.value.2",
                          "1.baseStep2": "1.value",
                          "2.baseStep2": "2.value"
                        }
                      }
                    ],
                    "tags": {
                      "root.tag.1": "root.value.1",
                      "root.tag.2": "root.value.2",
                      "1.baseStep1": "1.value",
                      "2.baseStep1": "2.value"
                    }
                  }
                ],
                "tags": {
                  "root.tag.1": "root.value.1",
                  "root.tag.2": "root.value.2"
                }
              }
            ],
            "tags": {}
          }
        ];

        const tracer = new TracerStub();
        const waterfallTracer = buildWaterfallTracer(tracer, new StubLogger());
        const steps = waterfallTracer.decorateSteps(buildGetSequenceContext(tracer), stepDefinitions);

        steps.unshift(namedDefinitions.noArgsBaseStep0.handler);
        steps.push(namedDefinitions.baseStep3.handler);

        async.waterfall(steps, (err) => {
          assert.ifError(err);

          assert.deepEqual(tracer.getFullTrace(), expectedTrace);

          done();
        });
      });

      it('injects span into traceable steps', (done) => {
        const tracer = new TracerStub();
        const waterfallTracer = buildWaterfallTracer(tracer, new StubLogger());

        const stepDefinitions = [
          {
            handler: namedDefinitions.baseStep1.handler,
            isTraceableStep: false,
            name: 'baseStep1',
            getTags: namedDefinitions.baseStep1.getTags
          },
          {
            handler: namedDefinitions.baseStep2.handler,
            isTraceableStep: false,
            name: 'baseStep2',
            getTags: namedDefinitions.baseStep2.getTags,
          },
          {
            handler: namedDefinitions.traceableBaseStep3.handler,
            isTraceableStep: true,
            name: 'traceableBaseStep3',
            getTags: namedDefinitions.traceableBaseStep3.getTags,
          }
        ];

        const steps = waterfallTracer.decorateSteps(buildGetSequenceContext(tracer), stepDefinitions);

        steps.unshift(namedDefinitions.noArgsBaseStep0.handler);

        async.waterfall(steps, (err, arg1, arg2, arg3) => {
          assert.ifError(err);

          assert.equal(arg1, '3.res1');
          assert.equal(arg2, '3.res2');
          assert.equal(arg3, '3.res3');

          done();
        });
      });

      describe('when it fails getting the tags for part of the sequence', () => {
        const stepDefinitions = [
          {
            handler: namedDefinitions.baseStep1.handler,
            isTraceableStep: false,
            name: 'baseStep1',
            getTags: namedDefinitions.baseStep1.getTags
          },
          {
            handler: namedDefinitions.baseStep2.handler,
            isTraceableStep: false,
            name: 'baseStep2',
            getTags: () => { throw new Error(); },
          }
        ];

        const buildGetSequenceContext = (tracer) => function getSequenceContext() {
          return {
            operationName: 'fullSequence',
            tags: {
              'root.tag.1': 'root.value.1',
              'root.tag.2': 'root.value.2',
            },
            parentSpan: tracer.startSpan('rootSpan')
          };
        };

        it('does not fail', (done) => {
          const tracer = new TracerStub();
          const waterfallTracer = buildWaterfallTracer(tracer, new StubLogger());
          const steps = waterfallTracer.decorateSteps(buildGetSequenceContext(tracer), stepDefinitions);

          steps.unshift(namedDefinitions.noArgsBaseStep0.handler);
          steps.push(namedDefinitions.baseStep3.handler);

          async.waterfall(steps, (err, arg1, arg2, arg3) => {
            assert.ifError(err);

            assert.equal(arg1, '3.res1');
            assert.equal(arg2, '3.res2');
            assert.equal(arg3, '3.res3');

            done();
          });
        });

        it('ignores tags for the step', (done) => {
          const expectedTrace = [
            {
              "operation": "rootSpan",
              "finished": true,
              "childs": [
                {
                  "operation": "fullSequence",
                  "finished": true,
                  "childs": [
                    {
                      "operation": "baseStep1",
                      "finished": true,
                      "childs": [
                        {
                          "operation": "baseStep2",
                          "finished": true,
                          "childs": [],
                          "tags": {
                            "root.tag.1": "root.value.1",
                            "root.tag.2": "root.value.2"
                          }
                        }
                      ],
                      "tags": {
                        "root.tag.1": "root.value.1",
                        "root.tag.2": "root.value.2",
                        "1.baseStep1": "1.value",
                        "2.baseStep1": "2.value"
                      }
                    }
                  ],
                  "tags": {
                    "root.tag.1": "root.value.1",
                    "root.tag.2": "root.value.2"
                  }
                }
              ],
              "tags": {}
            }
          ];

          const tracer = new TracerStub();
          const waterfallTracer = buildWaterfallTracer(tracer, new StubLogger());
          const steps = waterfallTracer.decorateSteps(buildGetSequenceContext(tracer), stepDefinitions);

          steps.unshift(namedDefinitions.noArgsBaseStep0.handler);
          steps.push(namedDefinitions.baseStep3.handler);

          async.waterfall(steps, (err) => {
            assert.ifError(err);

            assert.deepEqual(tracer.getFullTrace(), expectedTrace);

            done();
          });
        });
      });

      describe('when it fails getting the context for the sequence', () => {
        it('does not fail', (done) => {
          const tracer = new TracerStub();
          const waterfallTracer = buildWaterfallTracer(tracer, new StubLogger());
          const steps = waterfallTracer.decorateSteps(() => {
            throw new Error();
          }, stepDefinitions);


          steps.unshift(namedDefinitions.noArgsBaseStep0.handler);
          steps.push(namedDefinitions.baseStep3.handler);

          async.waterfall(steps, (err, arg1, arg2, arg3) => {
            assert.ifError(err);

            assert.equal(arg1, '3.res1');
            assert.equal(arg2, '3.res2');
            assert.equal(arg3, '3.res3');

            done();
          });
        });
      });

      describe('when one of the steps callbacks with an error', () => {
        const stepDefinitions = [
          {
            handler: namedDefinitions.baseStep1.handler,
            isTraceableStep: false,
            name: 'baseStep1',
            getTags: namedDefinitions.baseStep1.getTags
          },
          {
            handler: namedDefinitions.errorStep2.handler,
            isTraceableStep: false,
            name: 'errorStep2',
            getTags: namedDefinitions.errorStep2.getTags,
          }
        ];

        const buildGetSequenceContext = (tracer) => function getSequenceContext() {
          return {
            operationName: 'fullSequence',
            tags: {
              'root.tag.1': 'root.value.1',
              'root.tag.2': 'root.value.2',
            },
            parentSpan: tracer.startSpan('rootSpan')
          };
        };

        it('calls each function with the correct arguments', (done) => {
          const tracer = new TracerStub();
          const waterfallTracer = buildWaterfallTracer(tracer, new StubLogger());
          const steps = waterfallTracer.decorateSteps(buildGetSequenceContext(tracer), stepDefinitions);

          steps.unshift(namedDefinitions.noArgsBaseStep0.handler);
          steps.push(namedDefinitions.baseStep3.handler);

          async.waterfall(steps, (err) => {
            assert.equal(err.message, 'myError');

            done();
          });
        });

        it('traces each step correctly', (done) => {
          const expectedTrace = [
            {
              "operation": "rootSpan",
              "finished": true,
              "childs": [
                {
                  "operation": "fullSequence",
                  "finished": true,
                  "childs": [
                    {
                      "operation": "baseStep1",
                      "finished": true,
                      "childs": [
                        {
                          "operation": "errorStep2",
                          "finished": true,
                          "childs": [],
                          "tags": {
                            "root.tag.1": "root.value.1",
                            "root.tag.2": "root.value.2",
                            "1.errorStep2": "1.value",
                            "2.errorStep2": "2.value",
                            'ERROR': true,
                            'SAMPLING_PRIORITY': 1
                          }
                        }
                      ],
                      "tags": {
                        "root.tag.1": "root.value.1",
                        "root.tag.2": "root.value.2",
                        "1.baseStep1": "1.value",
                        "2.baseStep1": "2.value"
                      }
                    }
                  ],
                  "tags": {
                    "root.tag.1": "root.value.1",
                    "root.tag.2": "root.value.2"
                  }
                }
              ],
              "tags": {}
            }
          ];

          const tracer = new TracerStub();
          const waterfallTracer = buildWaterfallTracer(tracer, new StubLogger());
          const steps = waterfallTracer.decorateSteps(buildGetSequenceContext(tracer), stepDefinitions);

          steps.unshift(namedDefinitions.noArgsBaseStep0.handler);
          steps.push(namedDefinitions.baseStep3.handler);

          async.waterfall(steps, () => {
            assert.deepEqual(tracer.getFullTrace(), expectedTrace);

            done();
          });
        });
      });
    });
  });
});
