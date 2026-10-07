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

var NR_TEST_UTILS = require("nr-test-utils");
var telemetry = NR_TEST_UTILS.require("@node-red/runtime/lib/api/telemetry");

var mockLog = () => ({
    log: sinon.stub(),
    debug: sinon.stub(),
    trace: sinon.stub(),
    warn: sinon.stub(),
    info: sinon.stub(),
    metric: sinon.stub(),
    audit: sinon.stub(),
    _: function() { return "abc"}
})

describe("runtime-api/telemetry", function() {
    describe("getTelemetrySettings", function() {
        it("returns the telemetry settings", async function() {
            telemetry.init({
                telemetry: {
                    getTelemetrySettings: function() {
                        return { enabled: true, configurable: true, prompt: false };
                    }
                }
            });
            var result = await telemetry.getTelemetrySettings({});
            result.should.have.property("enabled", true);
            result.should.have.property("configurable", true);
            result.should.have.property("prompt", false);
        });
    });
    describe("updateTelemetrySettings", function() {
        it("records the user choice and returns the updated settings", async function() {
            var setUserChoice = sinon.stub().returns(Promise.resolve());
            telemetry.init({
                log: mockLog(),
                telemetry: {
                    setUserChoice: setUserChoice,
                    getTelemetrySettings: function() {
                        return { enabled: true, configurable: true, prompt: false };
                    }
                }
            });
            var result = await telemetry.updateTelemetrySettings({ settings: { enabled: true } });
            setUserChoice.calledOnce.should.be.true();
            setUserChoice.firstCall.args[0].should.be.true();
            result.should.have.property("enabled", true);
        });
        it("rejects when enabled is not provided", async function() {
            telemetry.init({
                log: mockLog(),
                telemetry: {
                    setUserChoice: sinon.stub().returns(Promise.resolve()),
                    getTelemetrySettings: function() { return {}; }
                }
            });
            await telemetry.updateTelemetrySettings({ settings: {} }).then(function() {
                throw new Error("should have rejected");
            }).catch(function(err) {
                err.should.have.property("code", "invalid_settings");
                err.should.have.property("status", 400);
            });
        });
        it("rejects when the choice cannot be stored", async function() {
            var err = new Error("Telemetry settings are not configurable");
            err.code = "not_configurable";
            err.status = 400;
            telemetry.init({
                log: mockLog(),
                telemetry: {
                    setUserChoice: sinon.stub().returns(Promise.reject(err)),
                    getTelemetrySettings: function() { return {}; }
                }
            });
            await telemetry.updateTelemetrySettings({ settings: { enabled: false } }).then(function() {
                throw new Error("should have rejected");
            }).catch(function(err) {
                err.should.have.property("code", "not_configurable");
                err.should.have.property("status", 400);
            });
        });
    });
});
