    var KnoxedUp = require("../knoxed-up");
    var fs       = require('fs');
    var fsX      = require('fs-extended');
    var testCase = require('nodeunit').testCase;
    var async    = require('async');
    var syslog   = require('syslog-console').init('KnoxedUp-AwsSdk');
    var AwsS3    = require('../aws-s3.js');
    require('longjohn');

    syslog.disableTTY();

    // CREATE INSTANCE
    var S3 = new AwsS3({
        key:    'AKIAJ7CBLVZ2DSXOOBWQ',
        secret: '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',
        bucket: 'media.cameoapp.com',
        port:   80});

    var sFileHash = '62228dc488ce4a2619e460c117254db404981b1e';
    var aPath     = sFileHash.split('').slice(0, 3);
    var sPath     = aPath.join('/') + '/' + sFileHash;

    exports["Test Download To Temp"] = {
        setUp: function (callback) {
            fsX.clearTmp(callback);
        },

        tearDown: function (callback) {
            // clean up
            fsX.removeDirectory(fsX.getTmpSync() + sFileHash, function() {
                fsX.removeDirectory(fsX.getTmpSync() + sFileHash + '.avi', function() {
                    callback();
                });
            });
         },

         "Get File": function(test) {
            test.expect(2);
            var tempPath = fsX.getTmpSync() + sPath.split('/').pop();
            S3.getFile(sPath, tempPath, function(err, path) {
                    test.ifError(err,                      "Had Issue Downloading File To Temp");
                fs.exists(path, function(bExists) {
                    test.ok(bExists, "File Downloaded");
                    test.done();
                });
            });
         },

         "Get / Put File": function(test) {
            test.expect(4);
            var tempPath = fsX.getTmpSync() + sPath.split('/').pop();
            S3.getFile(sPath, tempPath, function(err, path) {
                    test.ifError(err,                      "Had Issue Downloading File To Temp");
                fs.exists(path, function(bExists) {
                    test.ok(bExists, "File Downloaded");
                    S3.putStream(path, 'test/' + sFileHash, {}, function(oError, sDestination) {
                        test.ifError(oError, "Issues uploading");
                        test.equal(sDestination, 'test/' + sFileHash, "File Uploaded");
                        test.done();
                    }, 0);
                });
            });
         },

        "Multi-Speed Test" : function(test) 
        {
            var iStart = Date.now();
            var iTotalDl = 0;
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
            var iTotalFileSize = 0;
            test.expect(aFiles.length * 3);
            // download files
            async.each(aFiles, 
                function(sHash, fAsyncCallback) 
                {
                    var sFile    = sHash.substr(0, 3).split('').join('/') + '/' + sHash;
                    var sLanding = fsX.getTmpSync() + sHash;
                    console.log('Downloading', sFile, 'to', sLanding);
                    S3.getFile(sFile, sLanding, 
                        function(oError, sDestination) 
                        {
                            test.ifError(oError, "Had Issue Downloading File To Temp");
                            if (oError != null)
                            {
                                console.log(oError);
                            }
                            aLocals.push(sDestination);
                            fs.stat(sDestination, 
                                function (err, stat)
                                {
                                    iTotalFileSize += stat.size;
                                } 
                            );
                            console.log('Downloaded', sDestination);
                            test.ok(true);
                            fAsyncCallback();
                        }
                    );
                }, 
                function() 
                {
                    console.log('Downloaded!');
                    iTotalDl = Date.now() - iStart;
                    iStart = Date.now();
                    // Now Upload them
                    async.each(aLocals, 
                        function(sFile, fAsyncCallback) 
                        {
                            dest = 'test/' + sFile.split('/').pop();
                            console.log('Uploading', sFile, 'to', dest);
                            S3.putStream(sFile, dest, {}, 
                                function(oError, sDestination) 
                                {
                                    console.log('Uploaded', sDestination);
                                    test.ok(true);
                                    fAsyncCallback();
                                }
                            );
                        },  
                        function() 
                        {   
                            var iTotalUp = Date.now() - iStart;
                            console.log('Done with', aFiles.length, 'files', iTotalFileSize, 'bytes');
                            console.log('Down Time', iTotalDl, 'Down Bandwidth', iTotalFileSize /(iTotalDl / 1000), 'bytes/sec');
                            console.log('Up Time', iTotalUp, 'Up Bandwidth', iTotalFileSize /(iTotalUp / 1000), 'bytes/sec');
                            test.done();
                        }
                    );
                }
            );
        }
    }



