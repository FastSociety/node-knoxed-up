    var KnoxedUp = require("../knoxed-up");
    var fs       = require('fs');
    var fsX      = require('fs-extended');
    var testCase = require('nodeunit').testCase;
    var async    = require('async');
    var syslog   = require('syslog-console').init('KnoxedUp');
    require('longjohn');

    //syslog.disableTTY();

    // CREATE INSTANCE

    var S3 = new KnoxedUp({
        key:    'AKIAJ7CBLVZ2DSXOOBWQ',
        secret: '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',
        bucket: 'media.cameoapp.com',
        port:   80
    });

    var sFileHash = '58801fbc406868579c6f1f92a2b0df63cc9dd1ed';
    var aPath     = sFileHash.split('').slice(0, 3);
    var sPath     = aPath.join('/') + '/' + sFileHash;

    S3.getFile(sPath, './gotFile', 'binary', function(oError, sWhatever) {
        console.log(oError, sWhatever);
    });