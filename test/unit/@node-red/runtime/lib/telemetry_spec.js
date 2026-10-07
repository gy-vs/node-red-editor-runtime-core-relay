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
var https = require("https");
var events = require("events");

var NR_TEST_UTILS = require("nr-test-utils");

var telemetry = NR_TEST_UTILS.require("@node-red/runtime/lib/telemetry");
var log = NR_TEST_UTILS.require("@node-red/util").log;
var redEvents = NR_TEST_UTILS.require("@node-red/util").events;

describe("runtime/telemetry", function() {
    this.timeout(0);

    var clock;
    var requests;
    var responses;
    var storedState;

    function handleRequest(options, callback) {
        var captured = { options: options, body: "" };
        requests.push(captured);
        var req = {
            write: function(data) { captured.body += data; },
            end: function() {
                var script = responses.length > 0 ? responses.shift() : { statusCode: 200, body: "{}" };
                if (script.error) {
                    if (req.errorHandler) {
                        req.errorHandler(script.error);
                    }
                    return;
                }
                var res = new events.EventEmitter();
                res.statusCode = script.statusCode;
                res.setEncoding = function() {};
                callback(res);
                if (script.body) {
                    res.emit("data", script.body);
                }
                res.emit("end");
            },
            on: function(event, handler) {
                if (event === "error") {
                    req.errorHandler = handler;
                }
                return req;
            },
            destroy: function() {}
        };
        return req;
    }

    function mockRuntime(telemetryConfig, version) {
        return {
            settings: {
                version: version || "4.0.0",
                telemetry: telemetryConfig,
                get: function(prop) {
                    if (prop === "telemetryState") {
                        return storedState;
                    }
                    if (prop === "instanceId") {
                        return "test-instance-id";
                    }
                    return undefined;
                },
                set: function(prop, value) {
                    if (prop === "telemetryState") {
                        storedState = value;
                    }
                    return Promise.resolve();
                }
            },
            nodes: {
                getFlows: function() {
                    return { flows: [
                        { id: "t1", type: "tab" },
                        { id: "n1", type: "inject", z: "t1" },
                        { id: "n2", type: "debug", z: "t1" },
                        { id: "c1", type: "mqtt-broker" }
                    ]};
                }
            }
        };
    }

    beforeEach(function() {
        requests = [];
        responses = [];
        storedState = undefined;
        clock = sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
        sinon.stub(https, "request").callsFake(handleRequest);
        sinon.stub(http, "request").callsFake(handleRequest);
        sinon.stub(log, "debug").callsFake(function() {});
        sinon.stub(log, "info").callsFake(function() {});
        sinon.stub(log, "_").callsFake(function() { return "abc"; });
    });

    afterEach(function() {
        telemetry.stop();
        clock.restore();
        https.request.restore();
        http.request.restore();
        log.debug.restore();
        log.info.restore();
        log._.restore();
        redEvents.removeAllListeners("runtime-event");
    });

    describe("settings resolution", function() {
        it("prompts when no choice has been made", function() {
            telemetry.init(mockRuntime(undefined));
            var settings = telemetry.getTelemetrySettings();
            settings.should.have.property("enabled", false);
            settings.should.have.property("configurable", true);
            settings.should.have.property("prompt", true);
            settings.should.not.have.property("updateAvailable");
        });
        it("uses the stored user choice when made", function() {
            storedState = { enabled: true };
            telemetry.init(mockRuntime(undefined));
            var settings = telemetry.getTelemetrySettings();
            settings.should.have.property("enabled", true);
            settings.should.have.property("configurable", true);
            settings.should.have.property("prompt", false);
        });
        it("uses the stored user choice when declined", function() {
            storedState = { enabled: false };
            telemetry.init(mockRuntime(undefined));
            var settings = telemetry.getTelemetrySettings();
            settings.should.have.property("enabled", false);
            settings.should.have.property("configurable", true);
            settings.should.have.property("prompt", false);
        });
        it("follows the settings file when explicitly enabled", function() {
            telemetry.init(mockRuntime({ enabled: true }));
            var settings = telemetry.getTelemetrySettings();
            settings.should.have.property("enabled", true);
            settings.should.have.property("configurable", false);
            settings.should.have.property("prompt", false);
        });
        it("follows the settings file when explicitly disabled", function() {
            storedState = { enabled: true };
            telemetry.init(mockRuntime({ enabled: false }));
            var settings = telemetry.getTelemetrySettings();
            settings.should.have.property("enabled", false);
            settings.should.have.property("configurable", false);
            settings.should.have.property("prompt", false);
        });
        it("is disabled and not configurable when disabled on the command line", function() {
            storedState = { enabled: true };
            telemetry.init(mockRuntime({ enabled: false, disabled: true }));
            var settings = telemetry.getTelemetrySettings();
            settings.should.have.property("enabled", false);
            settings.should.have.property("configurable", false);
            settings.should.have.property("prompt", false);
        });
        it("command line disable takes precedence over settings file enable", function() {
            telemetry.init(mockRuntime({ enabled: true, disabled: true }));
            var settings = telemetry.getTelemetrySettings();
            settings.should.have.property("enabled", false);
            settings.should.have.property("configurable", false);
            settings.should.have.property("prompt", false);
        });
        it("includes updateAvailable when an update has been recorded", function() {
            storedState = { enabled: true, updateVersion: "4.1.0" };
            telemetry.init(mockRuntime(undefined));
            var settings = telemetry.getTelemetrySettings();
            settings.should.have.property("updateAvailable", { version: "4.1.0" });
        });
        it("does not include updateAvailable when reporting is disabled", function() {
            storedState = { enabled: false, updateVersion: "4.1.0" };
            telemetry.init(mockRuntime(undefined));
            var settings = telemetry.getTelemetrySettings();
            settings.should.not.have.property("updateAvailable");
        });
        it("does not include updateAvailable when update notifications are disabled", function() {
            storedState = { enabled: true, updateVersion: "4.1.0" };
            telemetry.init(mockRuntime({ updateNotification: false }));
            var settings = telemetry.getTelemetrySettings();
            settings.should.have.property("enabled", true);
            settings.should.not.have.property("updateAvailable");
        });
    });

    describe("user choice", function() {
        it("persists the user choice", async function() {
            telemetry.init(mockRuntime(undefined));
            await telemetry.setUserChoice(true);
            storedState.should.have.property("enabled", true);
            telemetry.getTelemetrySettings().should.have.property("enabled", true);
            telemetry.getTelemetrySettings().should.have.property("prompt", false);
        });
        it("rejects when disabled on the command line", async function() {
            telemetry.init(mockRuntime({ enabled: false, disabled: true }));
            await telemetry.setUserChoice(true).then(function() {
                throw new Error("should have rejected");
            }).catch(function(err) {
                err.should.have.property("code", "not_configurable");
            });
        });
        it("rejects when configured in the settings file", async function() {
            telemetry.init(mockRuntime({ enabled: true }));
            await telemetry.setUserChoice(false).then(function() {
                throw new Error("should have rejected");
            }).catch(function(err) {
                err.should.have.property("code", "not_configurable");
            });
        });
    });

    describe("scheduling", function() {
        it("sends the first report after 30 minutes then every 24 hours", async function() {
            storedState = { enabled: true };
            telemetry.init(mockRuntime(undefined));
            telemetry.start();
            requests.should.have.length(0);
            await clock.tickAsync(30 * 60 * 1000);
            requests.should.have.length(1);
            await clock.tickAsync(24 * 60 * 60 * 1000);
            requests.should.have.length(2);
            await clock.tickAsync(24 * 60 * 60 * 1000);
            requests.should.have.length(3);
        });
        it("does not schedule reports when not enabled", async function() {
            telemetry.init(mockRuntime(undefined));
            telemetry.start();
            clock.countTimers().should.equal(0);
            await clock.tickAsync(48 * 60 * 60 * 1000);
            requests.should.have.length(0);
        });
        it("does not schedule reports when disabled on the command line", async function() {
            storedState = { enabled: true };
            telemetry.init(mockRuntime({ enabled: false, disabled: true }));
            telemetry.start();
            clock.countTimers().should.equal(0);
            await clock.tickAsync(48 * 60 * 60 * 1000);
            requests.should.have.length(0);
        });
        it("leaves no timers behind when stopped", async function() {
            storedState = { enabled: true };
            telemetry.init(mockRuntime(undefined));
            telemetry.start();
            clock.countTimers().should.equal(1);
            await clock.tickAsync(30 * 60 * 1000);
            requests.should.have.length(1);
            clock.countTimers().should.equal(1);
            telemetry.stop();
            clock.countTimers().should.equal(0);
            await clock.tickAsync(72 * 60 * 60 * 1000);
            requests.should.have.length(1);
        });
        it("leaves no timers behind after repeated start/stop", async function() {
            storedState = { enabled: true };
            telemetry.init(mockRuntime(undefined));
            for (var i = 0; i < 5; i++) {
                telemetry.start();
                telemetry.stop();
            }
            clock.countTimers().should.equal(0);
            await clock.tickAsync(72 * 60 * 60 * 1000);
            requests.should.have.length(0);
        });
        it("starts reporting when the user consents whilst running", async function() {
            telemetry.init(mockRuntime(undefined));
            telemetry.start();
            clock.countTimers().should.equal(0);
            await telemetry.setUserChoice(true);
            clock.countTimers().should.equal(1);
            await clock.tickAsync(30 * 60 * 1000);
            requests.should.have.length(1);
        });
        it("stops reporting when the user declines whilst running", async function() {
            storedState = { enabled: true };
            telemetry.init(mockRuntime(undefined));
            telemetry.start();
            clock.countTimers().should.equal(1);
            await telemetry.setUserChoice(false);
            clock.countTimers().should.equal(0);
            await clock.tickAsync(72 * 60 * 60 * 1000);
            requests.should.have.length(0);
        });
        it("continues reporting after a report failure", async function() {
            storedState = { enabled: true };
            telemetry.init(mockRuntime(undefined));
            telemetry.start();
            responses.push({ error: new Error("connection refused") });
            await clock.tickAsync(30 * 60 * 1000);
            requests.should.have.length(1);
            log.debug.called.should.be.true();
            await clock.tickAsync(24 * 60 * 60 * 1000);
            requests.should.have.length(2);
        });
    });

    describe("report", function() {
        beforeEach(function() {
            storedState = { enabled: true };
        });
        it("sends an anonymous payload", async function() {
            telemetry.init(mockRuntime(undefined, "4.0.1"));
            telemetry.start();
            await clock.tickAsync(30 * 60 * 1000);
            requests.should.have.length(1);
            var payload = JSON.parse(requests[0].body);
            payload.should.have.property("instanceId", "test-instance-id");
            payload.should.have.property("nodeRedVersion", "4.0.1");
            payload.should.have.property("nodeVersion", process.version);
            payload.should.have.property("platform", require("os").platform());
            payload.should.have.property("arch", require("os").arch());
            payload.should.have.property("container", telemetry._isContainer());
            payload.should.have.property("nodeCount", 2);
            payload.should.have.property("flowCount", 1);
            payload.should.not.have.property("hostname");
            payload.should.not.have.property("username");
            payload.should.not.have.property("ip");
            payload.should.not.have.property("flows");
        });
        it("sends to the configured endpoint", async function() {
            telemetry.init(mockRuntime({ endpoint: "http://telemetry.example.com:8080/custom/path" }));
            telemetry.start();
            await clock.tickAsync(30 * 60 * 1000);
            requests.should.have.length(1);
            requests[0].options.should.have.property("hostname", "telemetry.example.com");
            requests[0].options.should.have.property("port", "8080");
            requests[0].options.should.have.property("path", "/custom/path");
        });
        it("uses the default endpoint when not configured", async function() {
            telemetry.init(mockRuntime(undefined));
            telemetry.start();
            await clock.tickAsync(30 * 60 * 1000);
            requests.should.have.length(1);
            requests[0].options.should.have.property("hostname", "telemetry.nodered.org");
        });
        it("logs at debug level when the endpoint cannot be reached", async function() {
            telemetry.init(mockRuntime(undefined));
            telemetry.start();
            responses.push({ error: new Error("getaddrinfo ENOTFOUND") });
            await clock.tickAsync(30 * 60 * 1000);
            requests.should.have.length(1);
            log.debug.calledOnce.should.be.true();
        });
        it("logs at debug level when the endpoint returns an error status", async function() {
            telemetry.init(mockRuntime(undefined));
            telemetry.start();
            responses.push({ statusCode: 500, body: "error" });
            await clock.tickAsync(30 * 60 * 1000);
            requests.should.have.length(1);
            log.debug.calledOnce.should.be.true();
        });
        it("ignores an unparseable response", async function() {
            telemetry.init(mockRuntime(undefined));
            telemetry.start();
            responses.push({ statusCode: 200, body: "not json" });
            await clock.tickAsync(30 * 60 * 1000);
            requests.should.have.length(1);
            (storedState.updateVersion === undefined).should.be.true();
        });
    });

    describe("update check", function() {
        var runtimeEvents;
        beforeEach(function() {
            storedState = { enabled: true };
            runtimeEvents = [];
            redEvents.on("runtime-event", function(event) {
                runtimeEvents.push(event);
            });
        });
        it("records an available update and notifies", async function() {
            telemetry.init(mockRuntime(undefined, "4.0.0"));
            telemetry.start();
            responses.push({ statusCode: 200, body: JSON.stringify({ latest: "4.0.9", next: "4.1.0-beta.0" }) });
            await clock.tickAsync(30 * 60 * 1000);
            storedState.should.have.property("updateVersion", "4.0.9");
            runtimeEvents.should.have.length(1);
            runtimeEvents[0].should.have.property("id", "telemetry-update");
            runtimeEvents[0].should.have.property("retain", true);
            runtimeEvents[0].payload.should.have.property("version", "4.0.9");
            telemetry.getTelemetrySettings().should.have.property("updateAvailable", { version: "4.0.9" });
        });
        it("clears the update when up to date at the next check", async function() {
            storedState = { enabled: true, updateVersion: "4.0.9" };
            telemetry.init(mockRuntime(undefined, "4.0.9"));
            telemetry.start();
            responses.push({ statusCode: 200, body: JSON.stringify({ latest: "4.0.9", next: "4.1.0-beta.0" }) });
            await clock.tickAsync(30 * 60 * 1000);
            (storedState.updateVersion === undefined).should.be.true();
            runtimeEvents.should.have.length(1);
            runtimeEvents[0].should.have.property("id", "telemetry-update");
            runtimeEvents[0].should.have.property("retain", false);
            telemetry.getTelemetrySettings().should.not.have.property("updateAvailable");
        });
        it("does not notify when update notifications are disabled", async function() {
            telemetry.init(mockRuntime({ updateNotification: false }, "4.0.0"));
            telemetry.start();
            responses.push({ statusCode: 200, body: JSON.stringify({ latest: "4.0.9" }) });
            await clock.tickAsync(30 * 60 * 1000);
            runtimeEvents.should.have.length(0);
            telemetry.getTelemetrySettings().should.not.have.property("updateAvailable");
        });
        it("does not re-notify when the update has not changed", async function() {
            storedState = { enabled: true, updateVersion: "4.0.9" };
            telemetry.init(mockRuntime(undefined, "4.0.0"));
            telemetry.start();
            responses.push({ statusCode: 200, body: JSON.stringify({ latest: "4.0.9" }) });
            await clock.tickAsync(30 * 60 * 1000);
            storedState.should.have.property("updateVersion", "4.0.9");
            runtimeEvents.should.have.length(0);
        });
    });

    describe("getUpdateVersion", function() {
        beforeEach(function() {
            telemetry.init(mockRuntime(undefined));
        });
        it("compares a stable version against the latest stable version", function() {
            telemetry.getUpdateVersion("4.0.0", "4.0.9", "4.1.0-beta.0").should.equal("4.0.9");
        });
        it("does not prompt a stable version to install a prerelease", function() {
            should(telemetry.getUpdateVersion("4.0.9", "4.0.9", "4.1.0-beta.0")).be.null();
        });
        it("does not prompt when the latest stable is not newer", function() {
            should(telemetry.getUpdateVersion("4.0.9", "4.0.8", undefined)).be.null();
            should(telemetry.getUpdateVersion("4.0.9", "4.0.9", undefined)).be.null();
        });
        it("compares a prerelease version against the newer of latest and next", function() {
            telemetry.getUpdateVersion("4.1.0-beta.0", "4.0.9", "4.1.0-beta.1").should.equal("4.1.0-beta.1");
            telemetry.getUpdateVersion("4.1.0-beta.0", "4.1.0", "4.1.0-beta.1").should.equal("4.1.0");
        });
        it("does not prompt a prerelease version that is up to date", function() {
            should(telemetry.getUpdateVersion("4.1.0-beta.1", "4.0.9", "4.1.0-beta.1")).be.null();
        });
        it("handles missing version information", function() {
            should(telemetry.getUpdateVersion("4.0.0", undefined, undefined)).be.null();
            should(telemetry.getUpdateVersion("4.0.0", "not-a-version", undefined)).be.null();
            should(telemetry.getUpdateVersion("not-a-version", "4.0.9", undefined)).be.null();
            should(telemetry.getUpdateVersion("", "4.0.9", undefined)).be.null();
        });
        it("treats a git build of a prerelease as the prerelease", async function() {
            // The runtime appends -git to the version when running from a
            // git checkout - it should be ignored when comparing versions
            storedState = { enabled: true };
            telemetry.init(mockRuntime(undefined, "4.1.0-beta.0-git"));
            telemetry.start();
            responses.push({ statusCode: 200, body: JSON.stringify({ latest: "4.0.9", next: "4.1.0-beta.1" }) });
            await clock.tickAsync(30 * 60 * 1000);
            storedState.should.have.property("updateVersion", "4.1.0-beta.1");
        });
    });
});
