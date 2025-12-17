module.exports = {
  default: {
    paths: ['test/acceptance/features/**/*.feature'],
    require: [
      'test/acceptance/step-definitions/**/*.ts',
      'test/acceptance/support/**/*.ts',
    ],
    requireModule: [
      'ts-node/register',
      'tsconfig-paths/register',
    ],
    format: [
      'progress-bar',
      'html:test/reports/cucumber-report.html',
      'json:test/reports/cucumber-report.json',
      '@cucumber/pretty-formatter',
    ],
    formatOptions: {
      snippetInterface: 'async-await',
    },
    publishQuiet: true,
    parallel: 1,
  },
};
