    var KnoxedUp = require("../knoxed-up");
    var fs       = require('fs');
    var fsX      = require('fs-extended');
    var testCase = require('nodeunit').testCase;
    var async    = require('async');
    var syslog   = require('syslog-console').init('KnoxedUp');
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
         }
     };

    //     "To Temp (Private)": function(test) {
    //         test.expect(4);

    //         var header = AWS.S3.headObject({Key: sFileHash, Bucket: media.cameoapp.com);
    //         S3._toTemp(fsX.getTmpSync() + sPath.split('/').pop(), sPath, 'binary', sFileHash, '', function(oError, sTempFile, sHash) {
    //             test.ifError(oError,                      "Had Issue Downloading File To Temp");
    //             test.equal(sHash,     sFileHash,          "Downloaded file has Correct Hash");
    //             test.equal(sTempFile, fsX.getTmpSync() + sFileHash, "Temp file is Named Correctly");

    //             fs.exists(sTempFile || '', function(bExists) {
    //                 test.ok(bExists, "File Exists in /tmp");
    //                 test.done();
    //             });
    //         });
    //     },

    //     "To Temp With Extension (Private)": function(test) {
    //         test.expect(4);

    //         S3._toTemp(fsX.getTmpSync() + sPath.split('/').pop(), sPath, 'binary', sFileHash, '.avi', function(oError, sTempFile, sHash) {
    //             test.ifError(oError,                      "Had Issue Downloading File To Temp");
    //             test.equal(sHash,     sFileHash,          "Downloaded file has Correct Hash");
    //             test.equal(sTempFile, fsX.getTmpSync() + sFileHash + '.avi', "Temp file is Named Correctly");

    //             fs.exists(sTempFile || '', function(bExists) {
    //                 test.ok(bExists, "File Exists in /tmp");
    //                 test.done();
    //             });
    //         });
    //     },

    //     "To Temp With Hash Mismatch (Private)": function(test) {
    //         test.expect(1);

    //         S3._toTemp(fsX.getTmpSync() + sPath.split('/').pop(), sPath, 'binary', sFileHash + 'a', '.avi', function(oError, sTempFile, sHash) {
    //             test.throws(oError, 'File Hash Mismatch', "Caught Incorrect Hash");
    //             test.done();
    //         });
    //     },

    //     "To Temp (Public)": function(test) {
    //         test.expect(4);

    //         S3.toTemp(sPath, 'binary', sFileHash, function(oError, sTempFile, sHash) {
    //             test.ifError(oError,                      "Had Issue Downloading File To Temp");
    //             test.equal(sHash,     sFileHash,          "Downloaded file has Correct Hash");
    //             test.equal(sTempFile, fsX.getTmpSync() + sFileHash, "Temp file is Named Correctly");

    //             fs.exists(sTempFile || '', function(bExists) {
    //                 test.ok(bExists, "File Exists in /tmp");
    //                 test.done();
    //             });
    //         });
    //     },

    //     "To Temp With Extension (Public)": function(test) {
    //         test.expect(4);

    //         S3.toTemp(sPath, 'binary', sFileHash, '.avi', function(oError, sTempFile, sHash) {
    //             test.ifError(oError,                      "Had Issue Downloading File To Temp");
    //             test.equal(sHash,     sFileHash,          "Downloaded file has Correct Hash");
    //             test.equal(sTempFile, fsX.getTmpSync() + sFileHash + '.avi', "Temp file is Named Correctly");

    //             fs.exists(sTempFile || '', function(bExists) {
    //                 test.ok(bExists, "File Exists in /tmp");
    //                 test.done();
    //             });
    //         });
    //     },

    //     "To Temp With Hash Mismatch (Public)": function(test) {
    //         test.expect(1);

    //         S3.toTemp(sPath, 'binary', sFileHash + 'a', '.avi', function(oError, sTempFile, sHash) {
    //             test.throws(oError, 'File Hash Mismatch', "Caught Incorrect Hash");
    //             test.done();
    //         });
    //     },

    //     "From Temp (Private)": function(test) {
    //         test.expect(4);

    //         S3.toTemp(sPath, 'binary', sFileHash, function() {
    //             S3._fromTemp(fsX.getTmpSync() + sFileHash, sFileHash, '', function(oError, sTempFile, sHash) {
    //                 test.ifError(oError,                      "Had Issue Downloading File From Temp");
    //                 test.equal(sHash,     sFileHash,          "Downloaded file has Correct Hash");
    //                 test.equal(sTempFile, fsX.getTmpSync() + sFileHash, "Temp file is Named Correctly");

    //                 fs.exists(sTempFile || '', function(bExists) {
    //                     test.ok(bExists, "File Exists in /tmp");
    //                     test.done();
    //                 });
    //             });
    //         });
    //     },

    //     "From Temp (Public)": function(test) {
    //         test.expect(4);

    //         S3.toTemp(sPath, 'binary', sFileHash, function() {
    //             S3.toTemp(sPath, 'binary', sFileHash, function(oError, sTempFile, sHash) {
    //                 test.ifError(oError,                      "Had Issue Downloading File To Temp");
    //                 test.equal(sHash,     sFileHash,          "Downloaded file has Correct Hash");
    //                 test.equal(sTempFile, fsX.getTmpSync() + sFileHash, "Temp file is Named Correctly");

    //                 fs.exists(sTempFile || '', function(bExists) {
    //                     test.ok(bExists, "File Exists in /tmp");
    //                     test.done();
    //                 });
    //             });
    //         });
    //     },

    //     "Set Size and Headers (Private)": function(test) {
    //         test.expect(5);

    //         S3.toTemp(sPath, 'binary', sFileHash, function(oError, sTempFile, sHash) {
    //             test.ifError(oError,                      "Had Issue Downloading File To Temp");
    //             S3._setSizeAndHashHeaders(fsX.getTmpSync() + sFileHash, {}, function(oError, oHeaders) {
    //                 test.ifError(oError,                                                                "Had Issue Setting Headers");
    //                 test.equal(oHeaders['Content-Length'],  56322,                                      "Content Length Set Correctly");
    //                 test.equal(oHeaders['Content-MD5'],     'P6yNY2+gvwgbheTaaKdrMQ==',                 "MD5 Set Correctly");
    //                 test.equal(oHeaders['x-amz-meta-sha1'], '62228dc488ce4a2619e460c117254db404981b1e', "SHA1 Set Correctly");
    //                 test.done();
    //             });
    //         });
    //     }

        
    //     "Socket Hangup": function(test) {
    //         test.expect(1);

    //         var aFiles = [
    //             // Thumbnails
    //             "0063eca2902e404c231e7c1d2eedb4f4506528a8",
    //             "007e2ae89e23a9cc5e4128c65e193e7d40d68ab4",
    //             "023545d990c63b55c151630252fbbbd017f4a8bc",
    //             "027ddebfebb03be9dccd2365cc211a467297b8c5",
    //             "028daded69b30f74c1572cf2f7b04c0be7ce0286",
    //             "029c3545c2ead0111ddbb596dceababa09753e30",
    //             "03fd9a5438f7e87a5eca769140fd87775b442f53",
    //             "0445d4dbdd82d6d5c27ef8170bf81129bc562ebc",
    //             "04fa8a95a2b8b8a434bd038a30b3903de0ad0765",
    //             "050fb4b2f78b66c7f6f48d23e9e08b7fbaec421b",
    //             "0574e4c4239adc397abc75cb7d3a946536bd6752",
    //             "063b46d4de390d257eac0db0075702d1406bb0f8",
    //             "0680257268db35023234c455b6529c7d50d95120",
    //             "06b7b2b796c92a260c2fc0319a6376f32646e8ab",
    //             "06cffa9306e45986a38b71bce396c60efa8918af",
    //             "06e0ef10822f88b0869ea44c339801fdc9701cf5",
    //             "07e92f0287b8bd0c0f67e0672266e56eb655118f",
    //             "0810438e1328166a4c2322b05065df100cbd7695",
    //             "0815049ebefb89acf715d689b940bde9b00c9436",
    //             "089db88c35ba3ff6296672e22ddea22915e288a2",
    //             "0942eb6e54483f43b2ec811005aa3f7277ceec6b",
    //             "094d0e4b5cbe9345ec677cf887726936fe92b849",
    //             "0967722963847e542f8932a98312361cd567f970",
    //             "09f19309897902adfdfc5e4909d45989b08508e2",
    //             "0a36255385b8fc636673a7d64ea9004c14845bfb",
    //             "0a504fb774c53d41a3f2e1c5f2b8785038aba5f8",
    //             "0a7243c0f1b5989d5a9a6e92e6f042724d7fd8e4",

    //             // WAVs
    //             "02fd663763b580a84746c99291a26b0492e7a023",
    //             "042476a4d4be607fb1c6010138aa7c02f907f6c3",
    //             "06a1d8e2f80e7c51abebd1421210691c30ab8405",
    //             "06cfa3a68d5ea9c4052058501077c1a37042de13",
    //             "072c491951c0faa188fd56b736010723cf448572",
    //             "07a3293b8afe21c977bbccef2fcc83eb0138a081",
    //             "087aa558129db2cb572f7b5b0e1494cdbd546a9b",
    //             "0966f69b896a7af31a622df0034011619c9d0aed",
    //             "0de8c3bcdd72eb7c020437acf34ed45020b4570b"
    //         ];

    //         function shuffle(array) {
    //             var tmp, current, top = array.length;

    //             if(top) while(--top) {
    //                 current = Math.floor(Math.random() * (top + 1));
    //                 tmp = array[current];
    //                 array[current] = array[top];
    //                 array[top] = tmp;
    //             }

    //             return array;
    //         }

    //         aFiles = shuffle(aFiles);

    //         for (var i in aFiles) {
    //             var aPath = aFiles[i].split('').slice(0, 3);
    //             aFiles[i] = aPath.join('/') + '/' + aFiles[i];
    //         }

    //         var iTimes = 0;
    //         var iUntil = 5;
    //         var dl = function() {
    //             iTimes++;
    //             S3.filesToTempWithExtension(aFiles, 'binary', '.png', function(oError, oTempFiles) {
    //                 if (oError) {
    //                     console.error('ERROR', oError);
    //                     test.ok(false, "Retry Failed");
    //                     test.done();
    //                 } else {
    //                     console.log(oTempFiles);
    //                     var aTempFiles = [];
    //                     for (var sFile in oTempFiles) {
    //                         aTempFiles.push(oTempFiles[sFile]);
    //                     }

    //                     async.forEach(aTempFiles, fs.unlink, function() {
    //                         if (iTimes >= iUntil) {
    //                             test.ok(true, "Downloaded Properly");
    //                             test.done();
    //                         } else {
    //                             process.nextTick(dl);
    //                         }
    //                     });
    //                 }
    //             }.bind(this));
    //         };

    //         dl();
    //     }
        
    // };

    // exports["Update Headers"] = {
    //     "Content Type Set Correctly": function(test) {
    //         test.expect(1);

    //         var oHeaders = {
    //             'Content-Type':    'video/vnd.avi',
    //             'x-amz-meta-test': 'abc123'
    //         };

    //         S3.updateHeaders('5/9/3/593949e21dee8eeb9c7af2f26b87f8bb0c2241c3', oHeaders, function(oUpdateError) {
    //             S3.getHeaders('5/9/3/593949e21dee8eeb9c7af2f26b87f8bb0c2241c3', function(oGetError, oGetHeaders) {
    //                 test.equal(oGetHeaders['content-type'], oHeaders['Content-Type'], 'Content Type Updated Correctly');
    //                 test.done();
    //             });
    //         });
    //     },

    //     "Headers Set Correctly": function(test) {
    //         test.expect(1);

    //         var oHeaders = {
    //             'Content-Type':    'video/vnd.avi',
    //             'x-amz-meta-test': 'abc123'
    //         };

    //         S3.updateHeaders('5/9/3/593949e21dee8eeb9c7af2f26b87f8bb0c2241c3', oHeaders, function(oUpdateError) {
    //             S3.getHeaders('5/9/3/593949e21dee8eeb9c7af2f26b87f8bb0c2241c3', function(oGetError, oGetHeaders) {
    //                 test.equal(oGetHeaders['x-amz-meta-test'], oHeaders['x-amz-meta-test'], 'Headers Updated Correctly');
    //                 test.done();
    //             });
    //         });
    //     },

    //     "Headers Set Correctly After Copy": function(test) {
    //         test.expect(3);

    //         var sTestFile =  'test/copy_delete_me';

    //         var oHeaders = {
    //             'x-amz-meta-test': 'abc123'
    //         };

    //         S3.copyFile('5/9/3/593949e21dee8eeb9c7af2f26b87f8bb0c2241c3', sTestFile, function(oCopyError) {
    //             test.ifError(oCopyError, 'Get Headers Error');
    //             S3.getHeaders(sTestFile, function(oGetError, oGetHeaders) {
    //                 test.ifError(oGetError, 'Get Headers Error');
    //                 test.equal(oGetHeaders['x-amz-meta-test'], oHeaders['x-amz-meta-test'], 'Headers Updated Correctly');

    //                 S3.deleteFile(sTestFile, function() {
    //                     test.done();
    //                 });
    //             });
    //         });
    //     },

    //     "Headers Set Correctly After Move": function(test) {
    //         test.expect(1);

    //         var sTestFile  =  'test/copy_delete_me';
    //         var sTestFile2 =  'test/copy_delete_me2';

    //         var oHeaders = {
    //             'x-amz-meta-test': 'abc123'
    //         };

    //         S3.copyFile('5/9/3/593949e21dee8eeb9c7af2f26b87f8bb0c2241c3', sTestFile, function(oCopyError) {
    //             S3.moveFile(sTestFile, sTestFile2, function(oCopyError) {
    //                 S3.getHeaders(sTestFile2, function(oGetError, oGetHeaders) {
    //                     test.equal(oGetHeaders['x-amz-meta-test'], oHeaders['x-amz-meta-test'], 'Headers Updated Correctly');

    //                     S3.deleteFile(sTestFile, function() {
    //                         S3.deleteFile(sTestFile2, function() {
    //                             test.done();
    //                         });
    //                     });
    //                 });
    //             });
    //         });
    //     },

    //     "Headers Set Correctly After Copy To Bucket": function(test) {
    //         test.expect(1);

    //         var sToBucket = 'cameo.enobrev.net';

    //         var oHeaders = {
    //             'x-amz-meta-test': 'abc123'
    //         };

    //         var S3b = new KnoxedUp({
    //             key:    'AKIAJ7CBLVZ2DSXOOBWQ',
    //             secret: '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',
    //             bucket: sToBucket,
    //             port:   80
    //         });

    //         var sTestFile  =  'test/copy_delete_me';

    //         S3.copyFileToBucket('5/9/3/593949e21dee8eeb9c7af2f26b87f8bb0c2241c3', sToBucket, sTestFile, function(oCopyError) {
    //             S3b.getHeaders(sTestFile, function(oGetError, oGetHeaders) {
    //                 test.equal(oGetHeaders['x-amz-meta-test'], oHeaders['x-amz-meta-test'], 'Headers Updated Correctly');

    //                 S3b.deleteFile(sTestFile, function() {
    //                     test.done();
    //                 });
    //             });
    //         });
    //     }
    // };