import { Given, When, Then } from '@cucumber/cucumber';
import { expect } from 'chai';
import { ExportJobWorld } from '../support/world';

let testValue: number;

Given('I have a test setup', function (this: ExportJobWorld) {
  testValue = 0;
});

When('I run a simple assertion', function (this: ExportJobWorld) {
  testValue = 42;
});

Then('the assertion should pass', function (this: ExportJobWorld) {
  expect(testValue).to.equal(42);
});
