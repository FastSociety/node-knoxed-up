    var KnoxedUp = require("../knoxed-up");
    var fs       = require('fs');
    var fsX      = require('fs-extended');
    var testCase = require('nodeunit').testCase;
    var async    = require('async');
    var syslog   = require('syslog-console').init('KnoxedUp');
    var oConfig  = require('/etc/cameo/.config.js');

    syslog.disableTTY();

    // CREATE INSTANCE

    var S3        = new KnoxedUp(oConfig);
    var sFileHash = '58801fbc406868579c6f1f92a2b0df63cc9dd1ed';
    var aPath     = sFileHash.split('').slice(0, 3);
    var sPath     = aPath.join('/') + '/' + sFileHash;

    async.auto({
        first:  function(fAsyncCallback, oResults) { S3.getFile(sPath, './gotFile', 'binary', fAsyncCallback); },
        second: function(fAsyncCallback, oResults) { S3.getFile(sPath, './gotFile', 'binary', fAsyncCallback); },
        third:  function(fAsyncCallback, oResults) { S3.getFile(sPath, './gotFile', 'binary', fAsyncCallback); },
        fourth: function(fAsyncCallback, oResults) { S3.getFile(sPath, './gotFile', 'binary', fAsyncCallback); },
        fifth:  function(fAsyncCallback, oResults) { S3.getFile(sPath, './gotFile', 'binary', fAsyncCallback); },
        sixth:  function(fAsyncCallback, oResults) { S3.getFile(sPath, './gotFile', 'binary', fAsyncCallback); },
        seventh:function(fAsyncCallback, oResults) { S3.getFile(sPath, './gotFile', 'binary', fAsyncCallback); },
        eighth: function(fAsyncCallback, oResults) { S3.getFile(sPath, './gotFile', 'binary', fAsyncCallback); },
        ninth:  function(fAsyncCallback, oResults) { S3.getFile(sPath, './gotFile', 'binary', fAsyncCallback); },
        tenth:  function(fAsyncCallback, oResults) { S3.getFile(sPath, './gotFile', 'binary', fAsyncCallback); },
    }, function(oError, oResults) {
        for (var i in oResults) {
            if (oResults[i] != './gotFile') {
                console.log('FAIL', oResults);
                return
            }
        }

        console.log('GOOD', oResults);
    });