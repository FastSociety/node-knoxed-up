    var KnoxedUp    = require('../knoxed-up');
    var exec        = require('child_process').exec;
    var fs          = require('fs');
    var fsX         = require('fs-extended');
    var crypto      = require('crypto');
    var args        = process.argv.slice(2);

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

    var hashFile = function(sFile,cb) {
        var hash = crypto.createHash('sha1');
        hash.setEncoding('hex');
        
        var fileStream = fs.createReadStream(sFile);
        
        fileStream.on('end',function(oError) {
            hash.end();
            cb(oError,hash.read());
        });

        fileStream.pipe(hash);
    }

    var getFile = function(i,sHash,cb) {
        var sPath = getPath(sHash);
        s3.getFile(sPath, './' + sHash, 'binary', function(oError, sTempFile) {
            if (oError) {
                console.log('getFile KnoxedUp getFile caught error',oError);
                process.exit(1);
            } 
            else {
                console.log('getFile finished downloading file, about to take sha1 sum of downloaded file');
                exec('sha1sum ' + sTempFile, function(oError, sSTDOut, sSTDError) {
                    if (oError) {
                        console.error('getFile sha1sum Error', oError);
                        process.exit(1);
                    } 
                    else {
                        var aHash = sSTDOut.split(' ');
                        var sReturnedHash = aHash[0];
                // hashFile(sTempFile, function(oError, sReturnedHash) {
                //     if (oError) {
                //         console.error('getFile hashFile Error', oError);
                //         process.exit(1);
                //     } 
                //     else {
                        console.log('return hash (',sReturnedHash,') original ', sHash);
                        if (sReturnedHash !== sHash) {
                            console.log('getFile error with trial, sha1sum mismatch (',sReturnedHash,')',sHash);
                            process.exit(1);
                        }
                        else {
                            console.log('getFile matched hashes',sReturnedHash, sHash);
                            fs.unlink(sHash,function(oUnlinkError) {
                                s3.deleteFile(sPath, function(oError) {
                                    if (oError) {
                                        console.log('getFile s3.deleteFile returned error',oError);
                                        process.exit(1);
                                    }            
                                    else {    
                                        console.log('getFile s3.deleted File',sPath);            
                                        cb(i,sHash);
                                    }
                                });                                
                            });
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
        var shasum = crypto.createHash('sha1');      
        shasum.update(sData);
        var sHash = shasum.digest('hex');
        console.log('genBlob sHash',sHash);    
        fs.writeFile(sHash,sData,function(oError) {
            cb(oError,sHash);
        }.bind(this));
    }

    var go = function(i,cb) {
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
                                fs.unlink(sHash,function(oUnlinkError) {
                                    console.log('go deleted local file');
                                    getFile(i,sHash,cb);
                                });
                            }
                        });
                    }
                });
            }
        });        
    }
    var iDone=0,N=parseInt(args[0],10) || 10;
    for (var i=0;i < N;i++) {
        go(i,function(i,sHash) { 
            iDone++;
            console.log('main loop finished',i,sHash)
            if (iDone == N) {
                console.log('main loop finished all blob tests');
            }
        });
    }

}
catch (e) {
    console.log('tryCatch error',e);
}
