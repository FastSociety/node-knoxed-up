    var KnoxedUp    = require('../knoxed-up');
    var exec        = require('child_process').exec;
    var fs          = require('fs');
    var fsX         = require('fs-extended');
    var crypto      = require('crypto');
    var oConfig     = require('/etc/cameo/.config.js');
    var async       = require('async');
    var args        = process.argv.slice(2);

    var knoxConfig = {
        key:    oConfig.AMAZON.SERVER.ID,
        secret: oConfig.AMAZON.SERVER.SECRET,
        bucket: 'messel.test.cameo.tv',
        port:   80
    };

    // see http://docs.aws.amazon.com/general/latest/gr/rande.html#s3_region
    if (oConfig.AMAZON.REGION !== undefined)
        knoxConfig.region = oConfig.AMAZON.REGION;

    var s3 = new KnoxedUp(knoxConfig);

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

    var getFiles = function(oFiles,cb) {
        fsX.clearTmp(function() {
            s3.filesToTemp(oFiles, 'binary', function(oError, oTempFiles) {
                if (oError) {
                    console.log({action: 'getFiles error', error: oError, files: oFiles});
                    cb(oError);
                } 
                else {
                    console.log('getFiles copied all files ',oTempFiles);
                    var aTempFiles = [];
                    for (var sObj in oTempFiles) {
                        aTempFiles.push({ hash: sObj, file: oTempFiles[sObj]});
                    }
                    async.each(aTempFiles, function (oFile, fCallbackAsync) {
                        var sHash = oFile.hash;
                        // var sHash = oFile.split('/').pop();
                        console.log('getFiles before sha1sum of oFile',oFile,'sHash',sHash);
                        exec('sha1sum ' + oFile.file, function(oError, sSTDOut, sSTDError) {
                            if (oError) {
                                console.error('getFile sha1sum Error', oError);
                                fCallbackAsync(oError)
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
                                    var sError = 'getFile error with trial, sha1sum mismatch (' + sReturnedHash + ')' + sHash;
                                    console.log(sError);
                                    fCallbackAsync(sError);
                                }
                                else {
                                    console.log('getFile matched hashes',sReturnedHash, sHash);
                                    fs.unlink(oFile.file,function(oUnlinkError) {
                                        if (oUnlinkError) {
                                            console.log('getFile unable to unlink local file',oUnlinkError);
                                            fCallbackAsync(oUnlinkError);
                                        }
                                        else {
                                            var sPath = getPath(sHash);
                                            s3.deleteFile(sPath, function(oError) {
                                                if (oError) {
                                                    console.log('getFile s3.deleteFile returned error',oError);
                                                    fCallbackAsync(oError);
                                                }            
                                                else {    
                                                    console.log('getFile s3.deleted File',sPath);            
                                                    fCallbackAsync(null);
                                                }
                                            });
                                        }
                                    });
                                }
                            }
                        });                    
                    }.bind(this), function(oError) {
                        if (oError) {
                            console.log({action: 'getFiles error', error: oError});
                            process.exit(1);
                        } 
                        else {
                            cb(oError, oTempFiles);
                        }
                    }.bind(this));

                }
            });
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

    var go = function(nBlobs) {
        async.times(nBlobs, 
            function (i, fCallbackAsync) {
            // many sd videos 500k-1MB range
                genBlob(700000,function(oError,sHash) {
                    if (oError) {
                       console.log('genBlob error returned ',oError);
                       fCallbackAsync(oError);
                    }
                    else {
                        var sFrom = './' + sHash;
                        var sTo = getPath(sHash);   
                        console.log('go source',sFrom,'destination',sTo);

                        // rm file if it exists        
                        s3.deleteFile(sTo, function(oError) {
                            if (oError) {
                               console.log('s3.deleteFile returned error',oError);
                               fCallbackAsync(oError);
                            }
                            else {
                                console.log('go about to call s3.putStream');
                                s3.putStream(sFrom, sTo, {}, function(oError) {
                                    if (oError) {
                                        console.log('s3.putStream returned error',oError);
                                        fCallbackAsync(oError);
                                    } 
                                    else {
                                        console.log('go s3.putStream succeeded sha1hash',sHash);
                                        // remove local file
                                        fs.unlink(sHash,function(oUnlinkError) {
                                            console.log('go deleted local file',sHash);
                                            fCallbackAsync(null, { file: sHash, hash: sHash });
                                        });
                                    }
                                });
                            }
                        });
                    }
                });        
            }, 
            function(oError, aFiles) {
                if (oError) {
                    console.log('unable to upload random blobs',oError);
                    process.exit(1);
                } 
                else {
                    console.log('aFiles',aFiles);
                    var oFiles = {};
                    for (var i in aFiles) {
                        var oFile = aFiles[i];
                        oFiles[oFile.hash] = getPath(oFile.file);
                    }
                    console.log('oFiles',oFiles);
                    getFiles(oFiles, function(oError) {
                        if (oError) {
                            console.log('getFiles returned error',oError);
                            process.exit(1);
                        }
                        else {
                            console.log('getFiles successfully completed all blob tests');
                            process.exit(0);                        
                        }
                    });
                }
            }
        );
    }

    var iDone=0,N=parseInt(args[0],10) || 10;
    go(N);

}
catch (e) {
    console.log('tryCatch error',e);
}
