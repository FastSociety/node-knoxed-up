    var KnoxedUp    = require('../knoxed-up');
    var fs          = require('fs');
    var fsX         = require('fs-extended');
    var oConfig     = require('/etc/cameo/.config.js');
    var async       = require('async');

    var s3 = new KnoxedUp(oConfig);

    KnoxedUp.prototype.onProgress = function(oProgress) {
        // process.stdout.write(oProgress.percent + '%');
        console.log(oProgress.percent + '%');
    };

    var aFiles = [
        'f8c555e163d024c46a4fda9187c20fd184190110',
        'f6f70304d79be804de4253af54f81ada77d856be',
        '88175fcb140313288c172167f5a53d464a519f5a',
        '6c080e6466a57a57f94d84f4ff958e5399afe1df',
        'ba557b9cac98ab1999f1b6aed39bc14b364d5dc1',
        'd3e83c2cd81fd5e0f79ba2a01b4566b584432e33',
        '4ccbffaf79cad3e5049087132fe19d259e6731b8',
        '175cf31e826c06be293d9d91d846ca6cdc775c1c',
        '2802e299e8b8b873e7a5e39f898e1537d2cec1e4',
        'b491c87040226c99ac1a2d1828c4556c98deabe2',
        'aa40741c1dba62634c8684653747feee9874d100',
        'fe74f7de7b4fbc7995797cf4ecc3231a6cf3c311',
        '886bb5d41250aa80ce6c95fc7c1bab29e0a01035',
        '70eab6bdc48144e39a1c49256cb60339246249f0',
        '6972819674ba47c0e8539b82ef7c5c7ddb2e3f71',
        '56ed2c62d06ceff021a6168f96c6d170d188b18c',
        '1a8e6f3c5f1f1b26d0bbaa39c54e01c39760307f',
        'c2df7ab67b3af463f31944406b85e402ffa21f3d'
    ];

    var aLocals = [];

    // download files
    var S3 = new KnoxedUp(oConfig);
    async.each(aFiles, function(sHash, fAsyncCallback) {
        var sFile    = sHash.substr(0, 3).split('').join('/') + '/' + sHash;
        var sLanding = './' + sHash;
        fs.exists(sLanding, function(bExists) {
            if (bExists) {
                aLocals.push(sHash);
                console.log('Exists', sLanding);
                fAsyncCallback();
            } else {
                console.log('Downloading', sFile);
                S3.getFile(sFile, sLanding, 'binary', function(oError, sDestination) {
                    aLocals.push(sDestination);
                    console.log('Downloaded', sDestination);
                    fAsyncCallback();
                });
            }
        });

    }, function() {
        console.log('Downloaded!');

        // Now Upload them
        async.each(aLocals, function(sFile, fAsyncCallback) {
            console.log('Uploading', sFile);
            S3.putStream(sFile, 'test/' + sFile, {}, function(oError, sDestination) {
                console.log('Uploaded', sDestination);
                fAsyncCallback();
            });
        }, function() {
            console.log('Done!');
            process.exit(0);
        });
    });