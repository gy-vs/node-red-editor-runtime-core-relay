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
var request = require("supertest");
var express = require("express");
var bodyParser = require("body-parser");
var sinon = require("sinon");

var NR_TEST_UTILS = require("nr-test-utils");
var telemetry = NR_TEST_UTILS.require("@node-red/editor-api/lib/admin/telemetry");

describe("api/editor/telemetry", function() {
    var app;
    before(function() {
        app = express();
        app.use(bodyParser.json());
        app.get("/telemetry",telemetry.get);
        app.post("/telemetry",telemetry.post);
    });

    it("returns the telemetry settings", function(done) {
        var runtimeAPI = {
            telemetry: {
                getTelemetrySettings: async function(opts) {
                    return { enabled: true, configurable: true, prompt: false };
                }
            }
        };
        telemetry.init(runtimeAPI);
        request(app)
        .get("/telemetry")
        .expect(200)
        .end(function(err,res) {
            if (err) {
                return done(err);
            }
            res.body.should.have.property("enabled",true);
            res.body.should.have.property("configurable",true);
            res.body.should.have.property("prompt",false);
            done();
        });
    });

    it("updates the telemetry settings", function(done) {
        var updateTelemetrySettings = sinon.stub().returns(Promise.resolve({ enabled: false, configurable: true, prompt: false }));
        var runtimeAPI = {
            telemetry: {
                updateTelemetrySettings: updateTelemetrySettings
            }
        };
        telemetry.init(runtimeAPI);
        request(app)
        .post("/telemetry")
        .send({ enabled: false })
        .expect(200)
        .end(function(err,res) {
            if (err) {
                return done(err);
            }
            updateTelemetrySettings.calledOnce.should.be.true();
            updateTelemetrySettings.firstCall.args[0].should.have.property("settings",{ enabled: false });
            res.body.should.have.property("enabled",false);
            done();
        });
    });

    it("returns an error when the update fails", function(done) {
        var error = new Error("Telemetry settings are not configurable");
        error.status = 400;
        var runtimeAPI = {
            telemetry: {
                updateTelemetrySettings: async function(opts) {
                    throw error;
                }
            }
        };
        telemetry.init(runtimeAPI);
        request(app)
        .post("/telemetry")
        .send({ enabled: true })
        .expect(400)
        .end(function(err,res) {
            if (err) {
                return done(err);
            }
            done();
        });
    });
});
