/**
 * Copyright JS Foundation and other contributors, http://js.foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

var should = require("should");
var sinon = require("sinon");
var http = require("http");

var NR_TEST_UTILS = require("nr-test-utils");
var telemetry = NR_TEST_UTILS.require("@node-red/runtime/lib/telemetry");

function makeRuntime(opts) {
    opts = opts || {};
    var stored = {};
    var storageAvailable = opts.storageAvailable !== false;
    var fakeSettings = {
        version: opts.version || "4.1.0",
        instanceId: "test-instance-id",
        // Default to an unreachable local endpoint so tests never hit the
        // real telemetry server; individual tests override as needed
        telemetry: opts.telemetry || {url: "http://127.0.0.1:1/report"},
        telemetryForceDisabled: opts.forceDisabled || false,
        available: function() { return storageAvailable; },
        get: function(prop) {
            if (stored.hasOwnProperty(prop)) {
                return stored[prop];
            }
            if (prop === "instanceId") {
                return "test-instance-id";
            }
            return undefined;
        },
        set: function(prop, value) {
            stored[prop] = value;
            return Promise.resolve();
        }
    };
    return {
        settings: fakeSettings,
        events: { emit: sinon.stub() },
        log: {
            debug: sinon.stub(),
            _: function(id, params) { return id + ":" + (params && params.message ? params.message : ""); },
            audit: sinon.stub()
        },
        nodes: {
            getNodeList: function() {
                return opts.nodeList || [
                    {id:"type-a", module:"node-red", types:["inject","debug"]},
                    {id:"type-b", module:"node-red-node-foo", types:["foo"]}
                ];
            }
        },
        _stored: stored
    };
}

describe("runtime telemetry", function() {

    describe("enable priority", function() {
        afterEach(function() {
            telemetry.stop();
            telemetry._resetTimings();
        });

        it("is disabled when there is no stored choice and no explicit setting", function() {
            var runtime = makeRuntime();
            telemetry.init(runtime);
            telemetry._resolveEnabled().should.be.false();
            telemetry._isLocked().should.be.false();
            telemetry._shouldPrompt().should.be.true();
        });

        it("uses the stored instance-wide choice when nothing else decides", function() {
            var runtime = makeRuntime();
            telemetry.init(runtime);
            // Unreachable local endpoint so the immediate report fails quietly
            runtime.settings.telemetry = {url: "http://127.0.0.1:1/report"};
            return telemetry.setEnabled(true).then(function() {
                telemetry._resolveEnabled().should.be.true();
                telemetry._shouldPrompt().should.be.false();
                telemetry.stop();

                var runtime2 = makeRuntime();
                runtime2.settings.set("telemetryEnabled", true);
                telemetry.init(runtime2);
                telemetry._resolveEnabled().should.be.true();
                telemetry._shouldPrompt().should.be.false();
            });
        });

        it("follows an explicit enabled settings.js value", function() {
            var runtime = makeRuntime({telemetry: {enabled: true}});
            telemetry.init(runtime);
            telemetry._resolveEnabled().should.be.true();
            telemetry._isLocked().should.be.true();
            telemetry._shouldPrompt().should.be.false();
        });

        it("follows an explicit disabled settings.js value", function() {
            var runtime = makeRuntime({telemetry: {enabled: false}});
            telemetry.init(runtime);
            telemetry._resolveEnabled().should.be.false();
            telemetry._isLocked().should.be.true();
            telemetry._shouldPrompt().should.be.false();
        });

        it("forces off even when settings.js enables and the choice is stored true", function() {
            var runtime = makeRuntime({telemetry: {enabled: true}, forceDisabled: true});
            runtime.settings.set("telemetryEnabled", true);
            telemetry.init(runtime);
            telemetry._resolveEnabled().should.be.false();
            telemetry._isLocked().should.be.true();
            telemetry._shouldPrompt().should.be.false();
        });

        it("does not prompt when storage is unavailable", function() {
            var runtime = makeRuntime({storageAvailable: false});
            telemetry.init(runtime);
            telemetry._shouldPrompt().should.be.false();
        });

        it("rejects changing the choice when the setting is locked", function(done) {
            var runtime = makeRuntime({telemetry: {enabled: false}});
            telemetry.init(runtime);
            telemetry.setEnabled(true).then(function() {
                done(new Error("expected rejection"));
            }).catch(function(err) {
                err.code.should.eql("telemetry_locked");
                err.status.should.eql(400);
                done();
            });
        });
    });

    describe("version comparison", function() {
        var evaluate = telemetry._evaluateUpdate;

        it("updates a stable install to a newer stable version", function() {
            evaluate("4.0.0", "4.1.0", "4.2.0-beta.0")
                .should.eql({version: "4.1.0", prerelease: false});
        });

        it("never prompts a stable install to a beta", function() {
            should(evaluate("4.1.0", "4.1.0", "4.2.0-beta.0")).be.null();
        });

        it("does nothing when already on the latest stable", function() {
            should(evaluate("4.1.0", "4.1.0", "4.1.1-beta.0")).be.null();
        });

        it("updates a beta install to the newer of latest/next", function() {
            evaluate("4.1.0-beta.0", "4.1.0", "4.2.0-beta.1")
                .should.eql({version: "4.2.0-beta.1", prerelease: true});
        });

        it("updates a beta install to stable when stable is newer", function() {
            evaluate("4.1.0-beta.0", "4.1.0", "4.1.0-beta.1")
                .should.eql({version: "4.1.0", prerelease: false});
        });

        it("does not flag a beta that is ahead of both channels", function() {
            should(evaluate("4.2.0-beta.2", "4.1.0", "4.2.0-beta.1")).be.null();
        });

        it("handles the local -git development suffix", function() {
            evaluate("4.0.0-git", "4.1.0", "4.1.0-beta.0")
                .should.eql({version: "4.1.0", prerelease: false});
        });

        it("returns null for invalid versions and missing data", function() {
            should(evaluate("not-a-version", "4.1.0", null)).be.null();
            should(evaluate("", "4.1.0", "4.2.0")).be.null();
            should(evaluate("4.0.0", null, null)).be.null();
        });
    });

    describe("scheduling", function() {
        var clock;
        afterEach(function() {
            if (clock) {
                clock.restore();
                clock = null;
            }
            telemetry.stop();
            telemetry._resetTimings();
        });

        it("does not schedule when disabled", function() {
            clock = sinon.useFakeTimers();
            var runtime = makeRuntime();
            telemetry.init(runtime);
            telemetry.start();
            telemetry._isScheduled().should.be.false();
        });

        it("does not schedule when force disabled even if settings enable", function() {
            clock = sinon.useFakeTimers();
            var runtime = makeRuntime({telemetry: {enabled: true}, forceDisabled: true});
            telemetry.init(runtime);
            telemetry.start();
            telemetry._isScheduled().should.be.false();
        });

        it("sends the first report after 30 minutes then every 24 hours", function() {
            this.timeout(10000);
            var runtime = makeRuntime({telemetry: {enabled: true}, version: "4.0.0"});
            var server;
            var requests = 0;
            return new Promise(function(resolve, reject) {
                server = http.createServer(function(req,res) {
                    requests++;
                    res.writeHead(200, {"Content-Type": "application/json", "Connection": "close"});
                    res.end(JSON.stringify({latest: "4.1.0", next: "4.2.0-beta.0"}));
                    if (requests === 3) {
                        resolve();
                    }
                });
                server.on("error", reject);
                server.listen(0, "127.0.0.1", function() {
                    runtime.settings.telemetry.url = "http://127.0.0.1:"+server.address().port;
                    telemetry.init(runtime);
                    telemetry._setTimings({firstReportDelay: 30, reportInterval: 30});
                    telemetry.start();
                    telemetry._isScheduled().should.be.true();
                });
            }).then(function() {
                requests.should.eql(3);
                telemetry.stop();
                return new Promise(function(resolve) { server.close(resolve); });
            });
        });

        it("clears all timers on stop", function() {
            clock = sinon.useFakeTimers();
            var runtime = makeRuntime({telemetry: {enabled: true}});
            telemetry.init(runtime);
            telemetry._setTimings({firstReportDelay: 1000});
            telemetry.start();
            telemetry._isScheduled().should.be.true();
            telemetry.stop();
            telemetry._isScheduled().should.be.false();
        });

        it("starts scheduling when enabled via the editor after startup", function() {
            var runtime = makeRuntime();
            telemetry.init(runtime);
            telemetry.start();
            telemetry._isScheduled().should.be.false();
            // Point at an unreachable port so the immediate report fails quietly
            runtime.settings.telemetry = {url: "http://127.0.0.1:1/report"};
            return telemetry.setEnabled(true).then(function() {
                telemetry._isScheduled().should.be.true();
                telemetry.getStatus().enabled.should.be.true();
            });
        });

        it("stops scheduling and clears the update when disabled via the editor", function() {
            var runtime = makeRuntime();
            telemetry.init(runtime);
            return telemetry.setEnabled(true).then(function() {
                telemetry._isScheduled().should.be.true();
                return telemetry.setEnabled(false);
            }).then(function() {
                telemetry._isScheduled().should.be.false();
                telemetry.getStatus().enabled.should.be.false();
                should(telemetry.getStatus().update).be.null();
            });
        });
    });

    describe("reporting", function() {
        var runtime;
        afterEach(function() {
            telemetry.stop();
        });

        it("posts the expected anonymous payload and processes the response", function() {
            var received;
            var server;
            runtime = makeRuntime({version: "4.1.0-beta.0"});
            var port;
            return new Promise(function(resolve, reject) {
                server = http.createServer(function(req,res) {
                    var body = "";
                    req.on("data", function(c) { body += c; });
                    req.on("end", function() {
                        received = JSON.parse(body);
                        res.writeHead(200, {"Content-Type": "application/json"});
                        res.end(JSON.stringify({latest: "4.1.0", next: "4.2.0-beta.1"}));
                    });
                    req.on("error", reject);
                });
                server.on("error", reject);
                server.listen(0, "127.0.0.1", function() {
                    port = server.address().port;
                    runtime.settings.telemetry = {url: "http://127.0.0.1:"+port};
                    telemetry.init(runtime);
                    telemetry._sendReport().then(resolve, reject);
                });
            }).then(function() {
                received.should.have.property("instanceId", "test-instance-id");
                received.should.have.property("version", "4.1.0-beta.0");
                received.should.have.property("currentVersion", "4.1.0-beta.0");
                received.should.have.property("nodeVersion", process.versions.node);
                received.should.have.property("platform", process.platform);
                received.should.have.property("arch", process.arch);
                received.should.have.property("container");
                received.should.have.property("nodeTypes", 3);
                received.should.have.property("modules", 2);
                // Sensitive values must never be present
                should(received.hostname).be.undefined();
                should(received.user).be.undefined();
                should(received.ip).be.undefined();
                should(received.flows).be.undefined();

                var status = telemetry.getStatus();
                status.update.should.eql({version: "4.2.0-beta.1", prerelease: true});
                return new Promise(function(resolve) { server.close(resolve); });
            });
        });

        it("does not record an update when versionCheck is disabled", function() {
            var server;
            runtime = makeRuntime({version: "4.0.0", telemetry: {versionCheck: false}});
            return new Promise(function(resolve) {
                server = http.createServer(function(req,res) {
                    res.writeHead(200, {"Content-Type": "application/json"});
                    res.end(JSON.stringify({latest: "4.1.0"}));
                });
                server.listen(0, "127.0.0.1", function() {
                    runtime.settings.telemetry.url = "http://127.0.0.1:"+server.address().port;
                    telemetry.init(runtime);
                    telemetry._sendReport().then(resolve);
                });
            }).then(function() {
                should(telemetry.getStatus().update).be.null();
                telemetry.getStatus().versionCheckDisabled.should.be.true();
                return new Promise(function(resolve) { server.close(resolve); });
            });
        });

        it("ignores the response to a report that was in flight when telemetry got disabled", function() {
            var server;
            var respond;
            runtime = makeRuntime({version: "4.0.0"});
            var started = new Promise(function(resolve) {
                server = http.createServer(function(req,res) {
                    respond = function() {
                        res.writeHead(200, {"Content-Type": "application/json"});
                        res.end(JSON.stringify({latest: "4.1.0"}));
                    };
                    req.resume();
                    resolve();
                });
            });
            var port;
            return new Promise(function(resolve) {
                server.listen(0, "127.0.0.1", function() {
                    port = server.address().port;
                    runtime.settings.telemetry = {url: "http://127.0.0.1:"+port};
                    telemetry.init(runtime);
                    resolve();
                });
            }).then(function() {
                var inFlight = telemetry._sendReport();
                return started.then(function() {
                    return telemetry.setEnabled(false);
                }).then(function() {
                    should(telemetry.getStatus().update).be.null();
                    respond();
                    return inFlight;
                }).then(function() {
                    // Response must not have republished an update
                    should(telemetry.getStatus().update).be.null();
                    return new Promise(function(resolve) { server.close(resolve); });
                });
            });
        });

        it("survives an unreachable endpoint without throwing and logs only debug", function() {
            runtime = makeRuntime();
            runtime.settings.telemetry = {url: "http://127.0.0.1:1/v1/report"};
            telemetry.init(runtime);
            return telemetry._sendReport().then(function() {
                should(telemetry.getStatus().update).be.null();
                runtime.log.debug.calledOnce.should.be.true();
            });
        });

        it("ignores malformed JSON responses", function() {
            var server;
            runtime = makeRuntime({version: "4.0.0"});
            return new Promise(function(resolve) {
                server = http.createServer(function(req,res) {
                    res.writeHead(200, {"Content-Type": "application/json"});
                    res.end("this is not json");
                });
                server.listen(0, "127.0.0.1", function() {
                    runtime.settings.telemetry = {url: "http://127.0.0.1:"+server.address().port};
                    telemetry.init(runtime);
                    telemetry._sendReport().then(resolve);
                });
            }).then(function() {
                should(telemetry.getStatus().update).be.null();
                return new Promise(function(resolve) { server.close(resolve); });
            });
        });
    });
});
