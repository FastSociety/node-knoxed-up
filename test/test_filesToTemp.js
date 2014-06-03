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


    var t1 = Date.now();

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
                        // hashFile(oFile.file, function(oError, sReturnedHash) {
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


    var genBlob = function(oOptions,cb) {
        var length = oOptions.length;
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

    var go = function(nBlobs,nBytes) {
        async.times(nBlobs, 
            function (i, fCallbackAsync) {               
                var alreadyCalled = false;
                var fDone = function(oError, i, oResult) {
                    if (!alreadyCalled) {
                        alreadyCalled = true;
                        console.log('for ith blob',i,'about to call fCallbackAsync with oError',oError,'oResult',oResult);
                        return fCallbackAsync(oError,oResult);
                    }
                    else {
                        console.log('trying to re-use fCallbackAsync ith blob',i,'with oError,oResult',oError,oResult);
                    }
                }

                // many sd videos 500k-1MB range
                var oOptions = {
                    length : nBytes,
                    i : i
                };
                genBlob(oOptions,function(oError1,sHash) {
                    var oLocalOptions = oOptions;
                    if (oError1) {
                       console.log('genBlob error returned ',oError1);
                       console.log('about to call fCallbackAsyn for A i',oLocalOptions.i);
                       return fDone(oError1,oLocalOptions.i,null);
                    }
                    else {
                        var sFrom = './' + sHash;
                        var sTo = getPath(sHash);   
                        console.log('go source',sFrom,'destination',sTo);

                        console.log('go about to call s3.putStream');
                        // putFile never worked
                        // s3.putFile(sFrom, '', {}, function(oError3) {

                        var calledOnce = false;
                        var fCallMeOnce = function(oError,iBlob,oResult) {
                            if (!calledOnce) {
                                calledOnce = true;
                                console.log('for ith blob',iBlob,'about to call fCallbackAsync with oError',oError,'oResult',oResult);
                                return fCallbackAsync(oError,oResult);
                            }
                            else {
                                console.log('trying to re-use fCallbackAsync ith blob',iBlob,'with oError,oResult',oError,oResult);
                            }
                        }


                        s3.putStream(sFrom, sTo, {}, function(oError3) {
                            console.log('returning from s3.putstream ith blob',oLocalOptions.i);
                            if (oError3) {
                                console.log('s3.putStream returned error',oError3);
                                console.log('about to call fCallbackAsyn for C i',oLocalOptions.i);
                                return fCallMeOnce(oError3,oOptions.i);
                            } 
                            else {
                                console.log('go s3.putStream succeeded sha1hash',sHash);
                                // remove local file
                                fs.unlink(sHash,function(oUnlinkError) {
                                    if (oUnlinkError) {
                                        console.log('error unlinking local file',sHash,oUnlinkError);
                                        return fCallMeOnce(oUnlinkError,oOptions.i);
                                    }
                                    else {
                                        console.log('go deleted local file',sHash);
                                        console.log('about to call fCallbackAsyn for D i',oLocalOptions.i);
                                        return fCallMeOnce(null,oOptions.i, { file: sHash, hash: sHash });
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
                            console.log('getFiles successfully completed all blob tests',Date.now() - t1);
                            process.exit(0);                        
                        }
                    });
                }
            }
        );
    }

    var iDone=0,N=parseInt(args[0],10) || 10, NBytes=parseInt(args[1],10) || 700000;
    go(N,NBytes);

}
catch (e) {
    console.log('tryCatch error',e);
}
