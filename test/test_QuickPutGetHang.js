    var KnoxedUp    = require('../knoxed-up');
    var exec        = require('child_process').exec;
    var fs          = require('fs');
    var fsX         = require('fs-extended');
    var crypto      = require('crypto');
    var shasum      = crypto.createHash('sha1');

    var s3 = new KnoxedUp({
        key:    'AKIAID4DZLKY7M5YJAFA',
        secret: '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',
        bucket: 'messel.test.cameo.tv',
        port:   80
    });

    KnoxedUp.prototype.onProgress = function(oProgress) {
        process.stdout.write("\r" + oProgress.percent + '%');
    }

try {

    var getPath = function(sHash) {
        return sHash.substr(0, 1) + '/' + sHash.substr(1, 1) + '/' + sHash.substr(2, 1) + '/' + sHash;
    };

    var getFile = function(sHash) {
        var sPath = getPath(sHash);
        s3.getFile(sPath, './' + sHash, 'binary', function(oError, sTempFile) {
            if (oError) {
                console.log('KnoxedUp getFile caught error',oError);
                process.exit(1);
            } 
            else {
                console.log('finished downloading file, about to take sha1 sum of downloaded file');
                exec('sha1sum ' + sTempFile, function(oError, sSTDOut, sSTDError) {
                    if (oError) {
                        console.error('sha1sum Error', oError);
                        process.exit(1);
                    } 
                    else {
                        var aHash = sSTDOut.split(' ');
                        console.log('return hash (',aHash[0],') original ', sHash);
                        if (aHash[0] !== sHash) {
                            console.log('error with trial, sha1sum mismatch (',aHash[0],')',sHash);
                            process.exit(1);
                        }
                        else {
                            console.log('matched hashes',aHash[0], sHash);
                            fs.unlinkSync(sHash);
                            process.exit(0);
                        }
                    }
                });
            }
        });
    }

    var genBlob = function(length,cb) {
        var aData = [];
        aData.length = length;
        for (var i=0;i < aData.length;i++) {
            aData[i] = String.fromCharCode( parseInt(Math.random() * 93,10) + 33  );
        }
        var sData = aData.join('');
        console.log('aData.length',aData.length,'sData.length',sData.length);
        shasum.update(sData);
        var sHash = shasum.digest('hex');
        console.log('genBlob sHash',sHash);    
        fs.writeFileSync(sHash,sData);
        cb(null,sHash);
    }

    var go = function() {
        // many sd videos 500k-1MB range
        genBlob(700000,function(oError,sHash) {
            if (oError) {
               console.log('genBlob error returned...',oError);
               process.exit(1);
            }
            else {
                var sFrom = './' + sHash;
                var sTo = getPath(sHash);   
                console.log('go source',sFrom,'destination',sTo);

                // rm file if it exists        
                s3.deleteFile(sTo, function(oError) {
                    if (oError) {
                       console.log('s3.deleteFile returned error',oError);
                       process.exit(1);
                    }
                    else {
                        console.log('go about to call s3.putStream');
                        s3.putStream(sFrom, sTo, {}, function(oError) {
                            if (oError) {
                                console.log('s3.putStream returned error',oError);
                                process.exit(1);
                            } 
                            else {
                                console.log('go s3.putStream succeeded sha1hash',sHash);
                                // remove local file
                                fs.unlinkSync(sHash);
                                console.log('go deleted local file');
                                getFile(sHash);
                            }
                        });
                    }
                });
            }
        });        
    }


    go();

}
catch (e) {
    console.log('error',e);
}
