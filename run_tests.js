var reporter = require('nodeunit').reporters["default"];
reporter.run(['test/test.js', 'test/test_awsS3Wrapper.js']);
//reporter.run(['test/test_awsS3Wrapper.js']);
