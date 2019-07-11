const Mocha = require('mocha');
const axios = require('axios');
const Serializable = require('./Serializable.js');

const TestState = {
	PASSED: "Passed",
	FAILED: "Failed",
	PENDING: "Pending"
}

function MochaFollower(runner) {
	Serializable.apply(this, ['mocha']);
	this.runner = runner || MIRunner;
	this.logger = runner.logger;
	this.logger.registerModule(this);

	this.currentTest = undefined;
	this.stack = [];

	this.intercept();
}

MochaFollower.prototype = Object.create(Serializable.prototype);
MochaFollower.prototype.constructor = MochaFollower;

//TODO take mocha consts
MochaFollower.prototype.attach = function attach() {
	this.mochaRunner = this.runner.mochaRunner;
	this.logger.suites = [];
	this.logger.requests = [];

	this.mochaRunner.on("suite", (suite) => {
		const parent = this.stack[this.stack.length - 1];
		const record = new SuiteRecord(suite, parent);
		if (!parent)
			this.logger.suites.push(record)
		this.stack.push(record);
	});

	this.mochaRunner.on("suite end", (suite) => {
		this.stack.pop();
	});

	this.mochaRunner.on("test", (test) => {
		if (test instanceof Mocha.Test)
			this.currentTest = test;
	})

	this.mochaRunner.on("pass", (test) => {
		const suite = this.stack[this.stack.length - 1];
		suite.tests.push(new TestRecord(suite, test, TestState.PASSED));
	})
	this.mochaRunner.on("fail", (test) => {
		const suite = this.stack[this.stack.length - 1];
		suite.tests.push(new TestRecord(suite, test, TestState.FAILED));
	})
	this.mochaRunner.on("pending", (test) => {
		const suite = this.stack[this.stack.length - 1];
		suite.tests.push(new TestRecord(suite, test, TestState.PENDING));
	})
}

MochaFollower.prototype.intercept = function intercept() {
	const self = this;

	function resolved(response) {
		self.logger.all({ prefix: ["MOCHA", "INTERCEPT" ], message: `Intercepted response with code ${response.status}`});
		const collect = {
			request: {
				headers: response.config.headers,
				method: response.config.method,
				url: response.config.url,
				params: response.config.params,
				data: response.config.data,
				currentUrl: response.request._currentUrl 
			},
			response: {
				url: response.request.res.responseUrl,
				statusCode: response.request.res.statusCode,
				redirected: (response.request._redirectable && response.request._redirectable._isRedirect),
				data: response.data
			}
		}
		if (self.currentTest) {
			if (!self.currentTest._requests)
				self.currentTest._requests = [];
			self.currentTest._requests.push(collect);
		}
		return response;
	}

	function rejected(error) {
		self.logger.all({ prefix: ["MOCHA", "INTERCEPT" ], message: `Intercepted response rejection with code ${error.status}`});
		//console.log(error);
		const collect = {
			request: {
				headers: error.config.headers,
				method: error.config.method,
				url: error.config.url,
				params: error.config.params,
				data: error.config.data || "",
				currentUrl: error.request._currentUrl 
			}
		}
		if (error.response) {
			collect.response = {
				url: error.request.res.responseUrl,
				statusCode: error.request.res.statusCode,
				redirected: (error.request._redirectable && error.request._redirectable._isRedirected),
				data: error.response.data
			}
		}
		if (self.currentTest) {
			if (!self.currentTest._requests)
				self.currentTest._requests = [];
			self.currentTest._requests.push(collect);
		}
		return Promise.reject(error);
	}

	const stab = axios.create;
	axios.create = function createStab(...args) {
		const inst = stab.apply(axios, args);
		inst.interceptors.response.use(resolved, rejected);
		return inst;
	}

	axios.interceptors.response.use(resolved, rejected)
}

MochaFollower.prototype.tree = function tree(depth = 0, suite = this.logger.suites[0]) {
	const prefix = '  ';
	console.log(`${prefix.repeat(depth)}${(suite.root) ? "Root" : suite.suite.title}`);
	suite.tests.forEach(test => console.log(`${prefix.repeat(depth + 1)}[${test.state}] ${test.test.title}`))
	suite.suites.forEach(s => this.tree(depth + 1, s));
}

MochaFollower.prototype.serialize = function serialize() {
	return {
		states: TestState,
		suites: (this.logger.suites || []).map(s => s.serialize()) 
	}
}

class TestRecord {
	constructor(suite, test, state) {
		this.suite = suite;
		this.test = test;
		this.state = state;
		this.requests = test._requests || []
	}

	serialize() {
		return {
			title: this.test.title,
			state: this.state,
			requests: this.requests,
			error: (this.state === TestState.FAILED) ? {
				message: this.test.err.toString(),
				stack: this.test.err.stack,
			} : null
		}
	}
}

class SuiteRecord {
	constructor(suite, parent) {
		if (parent) {
			this.root = false;
			parent.suites.push(this);
		} else 
		this.root = true;
		this.suite = suite;
		this.tests = [];
		this.suites = [];
	}

	serialize() {
		return {
			root: this.root,
			title: this.suite.title,
			tests: this.tests.map(t => t.serialize()),
			suites: this.suites.map(s => s.serialize())
		}
	}	
}

module.exports = MochaFollower;
