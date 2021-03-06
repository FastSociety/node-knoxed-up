    var fs          = require('fs');
    var path        = require('path');
    var util        = require('util');
    var Knox        = require('knox');
    var fsX         = require('fs-extended');
    var xml2js      = require('xml2js');
    var async       = require('async');
    var Buffer      = require('buffer').Buffer;
    var syslog      = require('syslog-console').init('KnoxedUp');

    var KnoxedUp = function(oConfig) {
        this.iMinimumDownloadBitrate    = 500000;
        this.iMinimumUploadBitrate      = 500000;
        // if transfers drop below threshold 3 times in a row do something
        this.NBitRateFail = 3;
        this.aTimeoutLevels = oConfig.TIMEOUTS && oConfig.TIMEOUTS.FILE && oConfig.TIMEOUTS.FILE.KNOXEDUP ? oConfig.TIMEOUTS.FILE.KNOXEDUP : [10, 20, 30, 60, 300];

        if (oConfig.AMAZON !== undefined) {
            this.oConfig = {
                key:    oConfig.AMAZON.SERVER.ID,
                secret: oConfig.AMAZON.SERVER.SECRET,
                bucket: oConfig.AMAZON.BUCKET,
                secure: false,
                port:   80
            };

            // see http://docs.aws.amazon.com/general/latest/gr/rande.html#s3_region
            if (oConfig.AMAZON.REGION !== undefined) {
                this.oConfig.region = oConfig.AMAZON.REGION;
            }

            this.sOriginalBucket = oConfig.AMAZON.BUCKET;

            if (oConfig.AMAZON.LOCAL       !== undefined
            &&  oConfig.AMAZON.LOCAL_PATH  !== undefined) {
                KnoxedUp.setLocal(oConfig.AMAZON.LOCAL, oConfig.AMAZON.LOCAL_PATH);
            }
            this.iMinimumDownloadBitrate    = oConfig.AMAZON.MINIMUMDOWNLOADBITRATE;
            this.iMinimumUploadBitrate      = oConfig.AMAZON.MINIMUMUPLOADBITRATE;

        } else if (oConfig.key !== undefined) {
            this.oConfig         = oConfig;
            this.sOriginalBucket = oConfig.bucket;
        }

        if (oConfig.AMAZON.MAX_ASYNCHRONOUS_DOWNLOAD != undefined)
            this.oConfig.maxAsyncDownloads = oConfig.AMAZON.MAX_ASYNCHRONOUS_DOWNLOAD;
        else
            this.oConfig.maxAsyncDownloads = 100;

        this.Client  = Knox.createClient(this.oConfig);
    };

    /**
     *
     * @param {String} sCommand
     * @param {String} sFilename
     * @param {String} sType
     * @param {Object} oHeaders
     * @param {Function} fCallback
     * @param {Integer} [iAttempts]
     * @param {Integer} [iMaxAttempts]
     * @private
     */
    KnoxedUp.prototype._command = function (sCommand, sFilename, sType, oHeaders, fCallback, iAttempts, iMaxAttempts) {
            iAttempts    = iAttempts    !== undefined ? iAttempts    : 1;
            iMaxAttempts = iMaxAttempts !== undefined ? iMaxAttempts : 10;
        var bHasCallback = typeof fCallback == 'function';

        var oLog = {
            action:  'KnoxedUp._command.' + sCommand,
            command:  sCommand,
            file:     sFilename,
            headers:  oHeaders,
            attempts: iAttempts,
            callback: bHasCallback
        };

        var iMaxTimeout    = this.aTimeoutLevels[this.aTimeoutLevels.length - 1];
        var iTimeoutIndex  = 0;
        var iBitrateTimeoutIndex = 0;

        var iBitrateFail = 0;
        var iLengthTotal = null;
        var iLength      = 0;
        var sData        = '';
        var iLengthPrev = 0;

        var sTimer = syslog.timeStart(oLog.action, oLog);

        var iTimeout,iBitrateTimeout;

        var fDone  = function(fDoneCallback, oError, oResponse, sData) {
            clearInterval(iTimeout);
            clearInterval(iBitrateTimeout);

            if (oError) {
                syslog.error(oLog);
            } else {
                if (oLog.file_size !== undefined) {
                    oLog.bytes_per_ms = oLog.file_size / syslog.getTime(sTimer);
                    oLog.bps = (oLog.file_size * 8) / (syslog.getTime(sTimer)/1000);
                }

                syslog.timeStop(sTimer, oLog);
            }

            fDoneCallback(oError, oResponse, sData, iAttempts);
        };

        var fRetry = function(sAction, oError, iNewMaxAttempts) {
            clearInterval(iTimeout);
            clearInterval(iBitrateTimeout);

            iNewMaxAttempts = iNewMaxAttempts !== undefined ? iNewMaxAttempts : iMaxAttempts;

            if (iAttempts > iMaxAttempts) {
                oLog.action  = sAction + '.retry.max';
                oLog.error   = oError;
                fDone(fCallback, oLog.error);
            } else {
                // Exponential Backoff
                var iBackOff      = iAttempts <= 11 ? iAttempts : 11;
                var iNextAttempt  = Math.pow(2, iBackOff) * 1000;
                oLog.action       = sAction + '.retry';
                oLog.next_attempt = iNextAttempt;
                syslog.warn(oLog);

                setTimeout(function() {
                    this._command(sCommand, sFilename, sType, oHeaders, fCallback, iAttempts + 1, iNewMaxAttempts);
                }.bind(this), iNextAttempt);
            }
        }.bind(this);

        iTimeout = setInterval(function() {
            iTimeoutIndex++;

            if (iMaxTimeout <= iTimeoutIndex) {
                if (iMaxTimeout  % iTimeoutIndex == 0) { // Multiple of the Final Time
                    syslog.error({
                        action: 'KnoxedUp.timeAlert',
                        error: new Error('We have been waiting for KnoxedUp for ' + iTimeoutIndex + ' seconds'),
                        oLog: oLog,
                        iLength: iLength,
                        iLengthTotal: iLengthTotal,
                        bps: (iLength*8)/iTimeoutIndex,
                        __ms: syslog.getTime(sTimer)
                    });
                }
            } else if (this.aTimeoutLevels.indexOf(iTimeoutIndex) >= 0) { // Warnings
                syslog.warn({
                    action: 'KnoxedUp.timeAlert',
                    warning: 'We have been waiting for KnoxedUp for ' + iTimeoutIndex + ' seconds',
                    oLog: oLog,
                    iLength: iLength,
                    iLengthTotal: iLengthTotal,
                    bps: (iLength*8)/iTimeoutIndex,
                    __ms: syslog.getTime(sTimer)
                });
                // if a del hasn't completed in 10seconds/first timeout retry somethings up...
                if (sCommand == 'del') {
                    oLog.action += '.tooSlow.retry';
                    syslog.warn({action: oLog.action, oLog: oLog});
                    return fRetry('KnoxedUp._command.' + sCommand + '.delTooSlow', new Error('Del action took way too long'));
                }
            }
        }.bind(this), 1000);

        iBitrateTimeout = setInterval(function() {
            iBitrateTimeoutIndex++;

            // monitor transfer rate, retry if bitrate drops less than threshold
            if (sCommand == 'get') {
                var MinimumAcceptableBitrate = this.iMinimumDownloadBitrate;
                var NDeltaBps = (iLength - iLengthPrev) * 8;
                iLengthPrev = iLength;
                if (NDeltaBps < MinimumAcceptableBitrate && iLength != oLog.file_size) {
                // if (NDeltaBps < MinimumAcceptableBitrate) {
                    iBitrateFail++;
                    if (iBitrateFail >= this.NBitRateFail) {
                        oLog.action += '.bitrate.retry';
                        syslog.warn({action: oLog.action, bps: NDeltaBps, meanbps: (iLength*8)/iTimeoutIndex, bytesTransferred:iLength, oLog: oLog });
                        return fRetry('KnoxedUp._command.' + sCommand + '.bitRateTooLow', new Error('Minimum Acceptable Bitrate failed'));
                    }
                }
                else {
                    iBitrateFail = 0;
                }
            }


        }.bind(this), 1000);

        var oRequest     = this.Client[sCommand](sFilename, oHeaders);

        oRequest.on('error', function(oError) {
            switch(oError.message) {
                case 'socket hang up':
                    return fRetry(oLog.action + '.request.hang_up', oError);
                    break;

                case 'read ECONNRESET':
                    return fRetry(oLog.action + '.request.connection_reset', oError);
                    break;

                default:
                    oLog.action += '.request.error';
                    oLog.error   = oError;
                    return fDone(fCallback, oLog.error);
                    break;
            }
        }.bind(this));

        oRequest.on('response', function(oResponse) {
            oLog.status = -1;
            if (oResponse) {
                oLog.status = oResponse.statusCode;
            }

            if (oResponse.headers !== undefined) {
                if (oResponse.headers['content-length'] !== undefined) {
                    iLengthTotal   = parseInt(oResponse.headers['content-length'], 10);
                    oLog.file_size = iLengthTotal;
                }
            }

            if (oResponse.statusCode == 500) {
                return fRetry('KnoxedUp._command.' + sCommand + '.request.hang_up', new Error('S3 Error Code ' + oResponse.statusCode));
            } else if (oResponse.statusCode > 500) {
                return fRetry('KnoxedUp._command.' + sCommand + '.request.error',   new Error('S3 Error Code ' + oResponse.statusCode));
            } else if(oResponse.statusCode == 404 && sCommand != 'head') {
                return fRetry('KnoxedUp._command.' + sCommand + '.request.error',   new Error('File Not Found'), 4);
            } else if(oResponse.statusCode != 404 && oResponse.statusCode > 399) {
                return fRetry('KnoxedUp._command.' + sCommand + '.request.error',   new Error('S3 Error Code ' + oResponse.statusCode), 4);
            } else {
                oResponse.setEncoding(sType);
                oResponse
                    .on('error', function(oError) {
                        oLog.error = oError;
                        fDone(fCallback, oLog.error);
                    })
                    .on('data', function(sChunk) {
                        sData   += sChunk;
                        iLength += sChunk.length;
                    })
                    .on('end', function(){
                        if (sCommand == 'get') {
                            if (iLengthTotal !== null) {
                                if (iLength < iLengthTotal) {
                                    return fRetry('KnoxedUp._command.get.response.incorrect.length', new Error('Content Length did not match Header'));
                                }
                            }
                        }

                        oLog.action = 'KnoxedUp._command.' + sCommand + '.done';
                        fDone(fCallback, null, oResponse, sData);
                    });
            }
        }.bind(this));

        oRequest.end();

        return oRequest;
    };

    KnoxedUp.prototype._get = function (sFilename, sType, oHeaders, fCallback) {
        if (!sFilename.match(/^\//)) {
            sFilename = '/' + sFilename;
        }

        return this._command('get', sFilename, sType, oHeaders, fCallback);
    };

    KnoxedUp.prototype._put = function (sFilename, sType, oHeaders, fCallback) {
        return this._command('put', sFilename, sType, oHeaders, fCallback);
    };

    KnoxedUp.prototype._head = function (sFilename, oHeaders, fCallback) {
        return this._command('head', sFilename, 'utf-8', oHeaders, fCallback);
    };

    KnoxedUp.prototype._delete = function (sFilename, oHeaders, fCallback) {
        return this._command('del', sFilename, 'utf-8',oHeaders, fCallback);
    };

    KnoxedUp.prototype.getFile = function (sFilename, sToFile, sType, fCallback) {
        syslog.debug({action: 'KnoxedUp.getFile', file: sFilename, to: sToFile, type: sType, bucket: this.oConfig.bucket, originalBucket: this.sOriginalBucket});

        var sTimer      = syslog.timeStart('KnoxedUp.getFile');
        var bError      = false;
        var bClosed     = false;
        var oHeaders    = {};
        var iFileHandle = null;

        var fDone = function(sFile) {
            syslog.timeStop(sTimer, {input: sFilename, output: sToFile, headers: oHeaders});

            fCallback(null, sToFile);
        }.bind(this);

        var fCheck = function(oError, sFile) {
            fsX.unlock(sFile, function() {
                if (oError) {
                    syslog.error({action: sTimer + '.error', input: sFilename, output: sFile, headers: oHeaders, error: oError});
                    fCallback(oError);
                } else if (oHeaders['x-amz-meta-sha1'] !== undefined) {
                    fsX.hashFile(sToFile, function(oError, sHash) {
                        if (oError) {
                            syslog.error({action: sTimer + '.hash.error', input: sFilename, output: sFile, headers: oHeaders, error: oError});
                            fCallback(oError);
                        } else if (oHeaders['x-amz-meta-sha1'] != sHash) {
                            syslog.error({action: sTimer + '.hash.mismatch.error', input: sFilename, output: sFile, headers: oHeaders, hash: sHash, error: new Error('Hash Mismatch')});
                            fCallback(oError);
                        } else if (KnoxedUp.isLocal()) {
                            this.localize(sToFile, sFilename, function() {
                                fDone(sFile);
                            });
                        } else {
                            fDone(sFile);
                        }
                    }.bind(this));
                } else if (KnoxedUp.isLocal()) {
                    this.localize(sToFile, sFilename, function() {
                        fDone(sFile);
                    });
                } else {
                    fDone(sFile);
                }
            }.bind(this));
        }.bind(this);

        if (KnoxedUp.isLocal() && this._localFileExistsSync(sFilename)) {
            fsX.copyFile(this.getLocalPath(sFilename), sToFile, function(oError, sFile) {
                fDone(sFile);
            });
        } else {
            var oResponse;

            fsX.writeLock(sToFile, {retries: 30, wait: 1000}, function(oLockError) {
                if (oLockError) {
                    return fCheck(oLockError);
                }

                var oToFile  = fs.createWriteStream(sToFile, {
                    flags:    'w'
                    //encoding: sType
                });

                oToFile.on('error', function(oError) {
                    bError = true;
                    syslog.error({action: sTimer + '.write.error', input: sFilename, message: 'failed to open file for writing: (' + sToFile + ')', error: oError});
                    fCheck(oError);
                });

                oToFile.on('close', function() {
                    bClosed = true;
                    if (!bError) {
                        syslog.debug({action: 'KnoxedUp.getFile.write.done', output: sToFile});
                        fCheck(null, sToFile);
                    }
                });

                var oRequest = this._get(sFilename, sType, {}, function(oError, oS3Response, sData, iRetries) {
                    oResponse = oS3Response;
                    if (oResponse) {
                        oHeaders = oResponse.headers;
                    }

                    syslog.debug({action: 'KnoxedUp.getFile.got'});
                    if (oError) {
                        syslog.error({action: sTimer + '.error', input: sFilename, error: oError});
                        bError = true;
                        oToFile.end();

                        fs.exists(sToFile, function(bExists) {
                            if (bExists) {
                                fs.unlink(sToFile, function() {
                                    syslog.debug({action: 'KnoxedUp.getFile.unlink.done'});
                                    fCheck(oError);
                                });
                            } else {
                                syslog.debug({action: 'KnoxedUp.getFile.done'});
                                fCheck(oError);
                            }
                        });
                    } else if (!bClosed) {
                        syslog.debug({action: 'KnoxedUp.getFile.request.end'});

                        // Weird case where file may be incomplete
                        // if (iRetries) { // this was always true
                        if (iRetries > 1) {
                            syslog.debug({action: 'KnoxedUp.getFile.request.end.retried'});
                            bError = true;
                            oToFile.end();

                            fs.writeFile(sToFile, sData, sType, function(oWriteError) {
                                if (oWriteError) {
                                    syslog.error({action: sTimer + '.writeFile.error', input: sFilename, error: oWriteError});
                                    fCheck(oWriteError);
                                } else {
                                    fCheck(null, sToFile);
                                }
                            })
                        }
                    }
                });

                oRequest.on('response', function(oS3Response) {
                    oResponse = oS3Response;
                    oHeaders = oResponse.headers;
                    syslog.debug({action: 'KnoxedUp.getFile.response'});

                    oResponse.on('data', function(sChunk) {
                        if (!bError) {
                            oToFile.write(sChunk, sType);
                        }
                    });

                    oResponse.on('end', function() {
                        //syslog.debug({action: 'KnoxedUp.getFile.response.end'});
                        oToFile.end();
                    });
                });
            }.bind(this));
        }
    };

    KnoxedUp.prototype.putFile = function (sFilename, sType, oHeaders, fCallback) {
        this._setSizeAndHashHeaders(sFilename, oHeaders, function(oError, oPreppedHeaders) {
            if (oError) {
                fCallback(oError);
            } else {
                this._put(sFilename, sType, oPreppedHeaders, fCallback);
            }
        }.bind(this));
    };

    KnoxedUp.prototype._setSizeAndHashHeaders = function (sFile, oHeaders, fCallback) {
        //syslog.debug({action: 'KnoxedUp._setSizeAndHashHeaders', file: sFile, headers: oHeaders});
        var oLockOpts = {
            retries:    300,
            wait:       100
        };

        async.auto({
            lock:                           function(fAsyncCallback) { fsX.readLock(sFile, oLockOpts, fAsyncCallback)},
            stat:   ['lock',                function(fAsyncCallback) { fs.stat(            sFile, fAsyncCallback);   }],
            md5:    ['lock',                function(fAsyncCallback) { fsX.md5FileToBase64(sFile, fAsyncCallback);   }],
            sha1:   ['lock',                function(fAsyncCallback) { fsX.hashFile(       sFile, fAsyncCallback);   }],
            unlock: ['stat', 'md5', 'sha1', function(fAsyncCallback) { fsX.unlock(sFile, fAsyncCallback)             }]
        }, function(oError, oResults) {
            if (oError) {
                syslog.error({action: 'KnoxedUp._setSizeAndHashHeaders.error', file: sFile, headers: oHeaders, error: oError});
                fCallback(oError);
            } else {
                var oYearFromNow = new Date();
                oYearFromNow.setFullYear(parseInt(oYearFromNow.getFullYear(), 10) + 10);

                oHeaders['Content-Length']  = oResults.stat.size;
                oHeaders['Content-MD5']     = oResults.md5;
                oHeaders['x-amz-meta-sha1'] = oResults.sha1;
                oHeaders['Expires']         = oYearFromNow.toUTCString();

                syslog.debug({action: 'KnoxedUp._setSizeAndHashHeaders.done', file: sFile, headers: oHeaders});
                fCallback(null, oHeaders);
            }
        });
    };

    KnoxedUp.prototype.setBucket = function(sBucket) {
        this.oConfig.bucket = sBucket;
        this.Client  = Knox.createClient(this.oConfig);
    };

    KnoxedUp.prototype.revertBucket = function() {
        this.setBucket(this.sOriginalBucket);
    };

    module.exports = KnoxedUp;

    /**
     *
     * @param {String}   sPrefix   Path of folder to list
     * @param {Integer}  iMax      Maximum number of files to show
     * @param {Function} fCallback Array of Objects in that folder
     */
    KnoxedUp.prototype.getFileList = function(sPrefix, iMax, fCallback) {
        fCallback  = typeof fCallback == 'function' ? fCallback  : function() {};

        var parser    = new xml2js.Parser();

        if (KnoxedUp.isLocal()) {
            var oMatch     = new RegExp('^' + sPrefix);
            var sPathLocal = this.getLocalPath();
            var getFiles   = function(sPath, aReturn) {
                aReturn = aReturn !== undefined ? aReturn : [];
                var aFiles = fs.readdirSync(path.join(sPathLocal, sPath));
                for (var i in aFiles) {
                    var sFile      = aFiles[i];
                    var sFullFile  = path.join(sPath, sFile);
                    var sFullLocal = path.join(sPathLocal, sFullFile);
                    var oStat = fs.statSync(sFullLocal);
                    if (oStat.isDirectory()) {
                        getFiles(sFullFile, aReturn);
                    } else if (sFullFile.match(oMatch)) {
                        aReturn.push(sFullFile);
                    }
                }

                return aReturn;
            };

            fCallback(null, getFiles());
        } else {
            this._get('/?prefix=' + sPrefix + '&max-keys=' + iMax, 'utf-8', {}, function(oError, oResponse, sData) {
                var iStatusCode = -1;
                if (oResponse) {
                    iStatusCode = oResponse.statusCode;
                }
                syslog.debug({action: 'KnoxedUp.getFileList', status: iStatusCode});

                if (oError) {
                    syslog.error({action: 'KnoxedUp.getFileList.error', error:oError});
                    fCallback(oError);
                } else {
                    parser.parseString(sData, function (oError, oResult) {
                        if (oError) {
                            fCallback(oError);
                        } else {
                            var aFiles = [];

                            if (oResult.ListBucketResult !== undefined) {
                                oResult = oResult.ListBucketResult;
                            }

                            var sKey;

                            if (oResult.Contents !== undefined) {
                                if (Array.isArray(oResult.Contents)) {
                                    for (var i in oResult.Contents) {
                                        if (oResult.Contents[i].Key) {
                                            sKey = oResult.Contents[i].Key;
                                            if (Array.isArray(sKey)) {
                                                sKey = sKey[0];
                                            }

                                            if (sKey.substr(-1) == '/') {
                                                continue;
                                            }

                                            aFiles.push(sKey)
                                        }
                                    }
                                } else {
                                    if (oResult.Contents.Key) {
                                        sKey = oResult.Contents.Key;
                                        if (Array.isArray(sKey)) {
                                            sKey = sKey[0];
                                        }

                                        if (sKey.substr(-1) != '/') {
                                            aFiles.push(sKey)
                                        }
                                    }
                                }
                            }

                            fCallback(null, aFiles);
                        }
                    }.bind(this));
                }
            }.bind(this));
        }
    };

    /**
     *
     * @param {String}   sPrefix   Path of folder to list
     * @param {Function} fCallback Array of Objects in that folder
     */
    KnoxedUp.prototype.getPrefixSize = function(sPrefix, fCallback) {
        fCallback  = typeof fCallback == 'function' ? fCallback  : function() {};

        var parser    = new xml2js.Parser();

        if (KnoxedUp.isLocal()) {
            fCallback(new Error ('No Local Version of This Method'));
        } else {
            var oReturn = {
                size:  0,
                count: 0
            };

            var getResults = function(iStart) {
                this._get('/?prefix=' + sPrefix + '&max-keys=1000&marker=' + iStart, 'utf-8', {}, function(oError, oResponse, sData) {
                    var iStatusCode = -1;
                    if (oResponse) {
                        iStatusCode = oResponse.statusCode;
                    }
                    syslog.debug({action: 'KnoxedUp.getFileList', status: iStatusCode});

                    if (oError) {
                        syslog.error({action: 'KnoxedUp.getFileList.error', error:oError});
                        fCallback(oError);
                    } else {
                        parser.parseString(sData, function (oError, oResult) {
                            if (oError) {
                                fCallback(oError);
                            } else {
                                if (oResult.ListBucketResult !== undefined) {
                                    oResult = oResult.ListBucketResult;
                                }

                                if (oResult.Contents !== undefined) {
                                    if (Array.isArray(oResult.Contents)) {
                                        for (var i in oResult.Contents) {
                                            oReturn.size += parseInt(oResult.Contents[i].Size, 10);
                                            oReturn.count++;
                                        }
                                    } else {
                                        if (oResult.Contents.Key) {
                                            oReturn.size += parseInt(oResult.Contents.Size, 10);
                                            oReturn.count++;
                                        }
                                    }
                                }

                                if (Array.isArray(oResult.IsTruncated)) {
                                    oResult.IsTruncated = oResult.IsTruncated[0];
                                }

                                if (oResult.IsTruncated == 'true') {
                                    getResults(iStart + 1000)
                                } else {
                                    fCallback(null, oReturn);
                                }
                            }
                        });
                    }
                });
            }.bind(this);

            getResults(0);
        }
    };

    /**
     *
     * @param {String} sFile       Path to file
     * @param {Function} fCallback boolean
     */
    KnoxedUp.prototype._localFileExists = function(sFile, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        fs.exists(this.getLocalPath(sFile), fCallback);
    };

    /**
     *
     * @param {String} sFile       Path to file
     * @return boolean
     */
    KnoxedUp.prototype._localFileExistsSync = function(sFile) {
        return fs.existsSync(this.getLocalPath(sFile));
    };

    /**
     *
     * @param {String} sFile       Path to file
     * @param {Function} fCallback boolean
     */
    KnoxedUp.prototype.fileExists = function(sFile, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        if (KnoxedUp.isLocal()) {
            this._localFileExists(sFile, fCallback);
        } else {
            this._head(sFile, {}, function(oError, oResponse) {
                if (oError) {
                    fCallback(oError);
                } else {
                    fCallback(null, oResponse.statusCode != 404);
                }
            }.bind(this));
        }
    };

    /**
     * Override me baby
     * @param {Object} oProgress
     */
    KnoxedUp.prototype.onProgress = function(oProgress) {

    };

    /**
     *
     * @param {String}   sFrom
     * @param {String}   sTo
     * @param {Object}   oHeaders
     * @param {Function} fCallback Full contents of File
     * @param {Integer} [iRetries]
     */
    KnoxedUp.prototype.putStream = function(sFrom, sTo, oHeaders, fCallback, iRetries) {
        var bHasCallback = typeof fCallback == 'function';
            iRetries     = iRetries !== undefined ? iRetries : 0;
            fCallback    = bHasCallback ? fCallback : function() {};

        var oLog = {
            action:   'KnoxedUp.putStream',
            from:     sFrom,
            to:       sTo,
            headers:  oHeaders,
            retries:  iRetries,
            callback: bHasCallback
        };

        var MAX_PUT_RETRIES = 3;

        var iTimeout, iBitrateTimeout;

        var sTimer = syslog.timeStart(oLog.action, oLog);

        if (KnoxedUp.isLocal()) {
            this.localize(sFrom, sTo, function() {
                fCallback(null, sTo);
            });
        } else {
            var fDone  = function(fFinishedCallback, oError, sTo) {
                clearInterval(iTimeout);
                clearInterval(iBitrateTimeout);
                fsX.unlock(sFrom, function(oLockError) {
                    if (oError) {
                        syslog.error(oLog);
                    } else {
                        if (oLog.file_size !== undefined) {
                            oLog.bytes_per_ms = oLog.file_size / syslog.getTime(sTimer);
                            oLog.bps = (oLog.file_size * 8) / (syslog.getTime(sTimer)/1000);
                        }

                        syslog.timeStop(sTimer, oLog);
                    }
                    fFinishedCallback(oError, sTo);
                });
            };

            var iBitrateFail = 0;
            var iLength = 0;
            var iLengthPrev = 0;
            var iMaxTimeout    = this.aTimeoutLevels[this.aTimeoutLevels.length - 1];
            var iTimeoutIndex = 0;
            var iBitrateTimeoutIndex = 0;

            // used a few times throughput putStream
            var fRetry = function(sAction,sError,sFrom,sTo,oHeaders,iRetries) {
                clearInterval(iBitrateTimeout);
                clearInterval(iTimeout);
                var fOriginalCallback = fCallback;
                fCallback = function(oError, oReturn) {
                    syslog.warn({
                        action: sAction,
                        error: sError,
                        oError: oError,
                        oReturn: oReturn
                    });
                };
                return this.putStream(sFrom, sTo, oHeaders, fOriginalCallback, iRetries + 1);                
            }.bind(this);            

            // start timeout counter
            iTimeout = setInterval(function() {
                iTimeoutIndex++;

                if (iMaxTimeout <= iTimeoutIndex) {
                    if (iMaxTimeout  % iTimeoutIndex == 0) { // Multiple of the Final Time
                        syslog.error({
                            action: 'KnoxedUp.putStream.timeAlert',
                            error: new Error('We have been waiting for KnoxedUp for ' + iTimeoutIndex + ' seconds'),
                            oLog: oLog,
                            iLength: iLength,
                            iLengthTotal: oLog.file_size ,
                            bps: (iLength*8)/iTimeoutIndex,
                            '__ms': syslog.getTime(sTimer)
                        });

                        /// KILLL MMEEEE!! (Not explicitly killing this upload here, but we've likely gone too far at this point)
                    }
                } else if (this.aTimeoutLevels.indexOf(iTimeoutIndex) >= 0) { // Warnings
                    syslog.warn({
                        action: 'KnoxedUp.putStream.timeAlert',
                        warning: 'We have been waiting for KnoxedUp for ' + iTimeoutIndex + ' seconds',
                        oLog: oLog,
                        iLength: iLength,
                        iLengthTotal: oLog.file_size ,
                        bps: (iLength*8)/iTimeoutIndex,
                        '__ms': syslog.getTime(sTimer)
                    });
                }
            }.bind(this), 1000);

            // start bitrate checker
            iBitrateTimeout = setInterval(function() {
                iBitrateTimeoutIndex++;

                // monitor transfer rate, retry if bitrate drops less than threshold
                var MinimumAcceptableBitrate = this.iMinimumUploadBitrate;
                var NDeltaBps = (iLength - iLengthPrev) * 8;
                iLengthPrev = iLength;
                if (NDeltaBps < MinimumAcceptableBitrate) {
                    iBitrateFail++;
                    if (iBitrateFail >= this.NBitRateFail) {
                        oLog.action += '.bitrate.retry';
                        oLog.bps = NDeltaBps;
                        syslog.warn(oLog);
                        return fRetry('KnoxedUp.putStream.bitrate.double_callback',
                            'callback is being attempted to be called more than once',
                            sFrom,sTo,oHeaders,iRetries);
                    }
                }
                else {
                    iBitrateFail = 0;
                }

            }.bind(this), 1000);


            this._setSizeAndHashHeaders(sFrom, oHeaders, function(oError, oPreppedHeaders) {
                if (oError) {
                    fDone(fCallback,oError);
                } else {
                    if (oPreppedHeaders['Content-Length'] !== undefined) {
                        oLog.file_size = oPreppedHeaders['Content-Length'];
                    }

                    fsX.readLock(sFrom, {retries: 300, wait: 100}, function(oLockError) {
                        if (oLockError) {
                            return fDone(fCallback, oLockError);
                        }

                        var oStream  = fs.createReadStream(sFrom);

                        oStream.on('error', function(oError) {
                            oStream.destroy();

                            oLog.error = new Error(oError);
                            fDone(fCallback, oLog.error);
                        });

                        var oRequest = this.Client.putStream(oStream, sTo, oPreppedHeaders, function(oError, oResponse) {
                            // useful for debugging s3 errors, force em
                            // if (iRetries < 2) {
                            //     // oError = 'fictional s3 error created';
                            //     oResponse.statusCode = 400;
                            // }                            
                            oStream.destroy();
                            oLog.status = -1;
                            if (oResponse) {
                                oLog.status = oResponse.statusCode;
                            }

                            if (oError) {
                                if (iRetries > MAX_PUT_RETRIES) {
                                    oLog.action += '.request.hang_up.retry.max';
                                    oLog.error   = oError;
                                    syslog.error(oLog);
                                    fDone(fCallback, oLog.error);
                                } else {
                                    oLog.action += '.request.hang_up.retry';
                                    oLog.error   = (util.isError(oError)) ? new Error(oError.message) : oError;
                                    syslog.warn(oLog);
                                    return fRetry('KnoxedUp.putStream.retry.double_callback',
                                        'callback is being attempted to be called more than once',
                                        sFrom,sTo,oHeaders,iRetries);
                                }
                            } else if(oResponse.statusCode >= 400) {
                                oLog.error   = new Error('S3 Error Code ' + oResponse.statusCode);
                                oLog.action += '.request.500.retry';
                                if (iRetries > MAX_PUT_RETRIES) {
                                    oLog.action += '.max';
                                    fDone(fCallback, oLog.error);
                                } else {
                                    syslog.warn(oLog);
                                    return fRetry('KnoxedUp.putStream.require.500.double_callback',
                                        'callback is being attempted to be called more than once',
                                        sFrom,sTo,oHeaders,iRetries);
                                }
                            } else {
                                oLog.action += '.done';
                                fDone(fCallback, null, sTo);
                            }
                        }.bind(this));

                        oRequest.on('progress', function(oProgress) {
                            iLength = oProgress.written;
                            this.onProgress(oProgress);
                        }.bind(this));
                    }.bind(this));
                }
            }.bind(this));
        }
    };

    /**
     *
     * @param {String}   sFile
     * @param {Object}   oHeaders
     * @param {Function} fCallback
     */
    KnoxedUp.prototype.updateHeaders = function(sFile, oHeaders, fCallback) {
        this.copyFile(sFile, sFile, oHeaders, fCallback);
    };

    /**
     *
     * @param {String}   sFile
     * @param {Function} fCallback
     */
    KnoxedUp.prototype.deleteFile = function(sFile, fCallback) {
        this._delete(sFile, {}, function(oError, oResponse, sData, iAttempts) {
            fCallback(oError, sData);
        });
    };

    /**
     *
     * @param {String} sFile
     * @param {Function} fCallback
     */
    KnoxedUp.prototype.getHeaders = function(sFile, fCallback) {
        this._head(sFile, {}, function(oError, oResponse) {
            if (oError) {
                syslog.error({action: 'KnoxedUp.getHeaders.error', error: oError});
                fCallback(oError);
            } else {
                //syslog.debug({action: 'KnoxedUp.getHeaders.done', headers: oResponse.headers});
                fCallback(null, oResponse.headers);
            }
        }.bind(this));
    };

    KnoxedUp.prototype.localize = function(sFrom, sTo, fCallback) {
        var sToLocal = this.getLocalPath(sTo);
        syslog.debug({action: 'KnoxedUp.localize', from: sFrom, local: sToLocal});
        fsX.mkdirP(path.dirname(sToLocal), 0777, function(oError) {
            if (oError) {
                syslog.error({action: 'KnoxedUp.localize.error', from: sFrom, local: sToLocal, error: oError});
                fCallback(oError)
            } else {
                fsX.copyFile(sFrom, sToLocal, function(oCopyError) {
                    if (oCopyError) {
                        syslog.error({action: 'KnoxedUp.localize.copy.error', from: sFrom, local: sToLocal, error: oCopyError});
                        fCallback(oCopyError);
                    } else {
                        syslog.debug({action: 'KnoxedUp.localize.done', from: sFrom, local: sToLocal});
                        fCallback(null, sTo);
                    }
                });
            }
        });
    };

    /**
     *
     * @param {String}            sFrom     Path of File to Move
     * @param {String}            sTo       Destination Path of File
     * @param {Object|Function}   oHeaders
     * @param {Function}         [fCallback]
     */
    KnoxedUp.prototype.copyFile = function(sFrom, sTo, oHeaders, fCallback) {
        if (typeof oHeaders == 'function') {
            fCallback = oHeaders;
            oHeaders  = {};
        }

        fCallback = typeof fCallback == 'function' ? fCallback : function() {};

        if (KnoxedUp.isLocal() && this._localFileExistsSync(sFrom)) {
            this.localize(sFrom, sTo, fCallback);
        } else {
            var bHasHeaders = false;
            for (var i in oHeaders) {
                bHasHeaders = true;
                break;
            }

            oHeaders['Content-Length']           = '0';
            oHeaders['x-amz-copy-source']        = '/' + this.Client.bucket + '/' + sFrom;
            oHeaders['x-amz-metadata-directive'] = 'REPLACE';

            /*
                 No way to just over-write headers.  It's all or nothing.  This way we keep what's there and add more
                 http://doc.s3.amazonaws.com/proposals/copy.html
                 COPY: Copy the metadata from the original object. If this is specified, any metadata in this request will be ignored. This is the default.
                 REPLACE: Ignore the original object’s metadata and replace it with the metadata in this request.
             */

            this.getHeaders(sFrom, function(oGetHeadersError, oGotHeaders) {
                if (oGetHeadersError) {
                    syslog.error({action: 'KnoxedUp.copyFile.getHeaders.error', error:  oGetHeadersError});
                    fCallback(oGetHeadersError);
                } else {
                    // Copy meta-headers from original
                    for (var sKey in oGotHeaders) {
                        // Do not override headers that were explictly set by method call
                        if (oHeaders[sKey] === undefined) {
                            // These are basically just copied from the S3 console
                            if (sKey.indexOf('x-amz-meta-')         == 0
                            ||  sKey.indexOf('Content-Type')        == 0
                            ||  sKey.indexOf('Content-Disposition') == 0
                            ||  sKey.indexOf('Content-Encoding')    == 0
                            ||  sKey.indexOf('Cache-Control')       == 0
                            ||  sKey.indexOf('Expires')             == 0 ) {
                                oHeaders[sKey] = oGotHeaders[sKey];
                                bHasHeaders    = true;
                            }
                        }
                    }

                    if (!bHasHeaders) {
                        oHeaders['x-amz-metadata-directive'] = 'COPY';
                    }

                    this._put(sTo, 'utf-8', oHeaders, function(oError, oResponse, sData) {
                        if (oError) {
                            syslog.error({action: 'KnoxedUp.copyFile.error', error:  oError});
                            fCallback(oError);
                        } else {
                            fCallback(null, sData);
                        }
                    }.bind(this));
                }
            }.bind(this));
        }
    };

    /**
     *
     * @param {String}   sFrom     Path of File to Move
     * @param {String}   sBucket   Destination Bucket
     * @param {String}   sTo       Destination Path of File
     * @param {Function} fCallback
     */
    KnoxedUp.prototype.copyFileToBucket = function(sFrom, sBucket, sTo, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        var sLocalPath = path.join(KnoxedUp.sPath, this.oConfig.bucket, sFrom);
        if (KnoxedUp.isLocal() && this._localFileExistsSync(sLocalPath)) {
            this.localize(sLocalPath, path.join(KnoxedUp.sPath, sBucket, sTo), fCallback);
        } else {
            var oOptions = {
                'Content-Length': '0',
                'x-amz-copy-source': '/' + this.Client.bucket + '/' + sFrom,
                'x-amz-metadata-directive': 'COPY'
            };

            var oDestination = new KnoxedUp({
                key:    this.Client.key,
                secret: this.Client.secret,
                bucket: sBucket,
                port:   80
            });

            oDestination._put(sTo, 'utf-8', oOptions, function(oError, oRequest, sData) {
                if (oError) {
                    syslog.error({action: 'KnoxedUp.copyFileToBucket.error', error:  oError});
                    fCallback(oError);
                } else {
                    //syslog.debug({action: 'KnoxedUp.copyFileToBucket.done'});
                    fCallback(null, sData);
                }
            }.bind(this));
        }
    };

    /**
     *
     * @param {String}   sFrom     Path of File to Move
     * @param {String}   sBucket   Destination Bucket
     * @param {String}   sTo       Destination Path of File
     * @param {Function} fCallback
     */
    KnoxedUp.prototype.moveFileToBucket = function(sFrom, sBucket, sTo, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        if (KnoxedUp.isLocal() && this._localFileExistsSync(sFrom)) {
            var sFromLocal = this.getLocalPath(sFrom);
            var sToLocal   = path.join(KnoxedUp.sPath, sBucket, sTo);
            fsX.mkdirP(path.dirname(sToLocal), 0777, function() {
                fsX.moveFile(sFromLocal, sToLocal, fCallback);
            }.bind(this));
        } else {
            this.copyFileToBucket(sFrom, sBucket, sTo, function(oError, sData) {
                if (oError) {
                    syslog.error({action: 'KnoxedUp.moveFileToBucket.copy.error', error: oError});
                    fCallback(oError);
                } else {
                    this._delete(sFrom, {}, function(oError) {
                        // Carry on even if delete didnt work - Error will be in the logs
                        fCallback(null, sData);
                    }.bind(this));
                }
            }.bind(this));
        }
    };

    /**
     *
     * @param {String}   sFrom     Path of File to Move
     * @param {String}   sTo       Destination Path of File
     * @param {Function} fCallback
     */
    KnoxedUp.prototype.moveFile = function(sFrom, sTo, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback : function() {};

        if (KnoxedUp.isLocal() && this._localFileExistsSync(sFrom)) {
            var sFromLocal = this.getLocalPath(sFrom);
            var sToLocal   = this.getLocalPath(sTo);
            fsX.mkdirP(path.dirname(sToLocal), 0777, function() {
                fsX.moveFile(sFromLocal, sToLocal, fCallback);
            }.bind(this));
        } else {
            if (sFrom == sTo) {
                fCallback(null);
            } else {
                this.copyFile(sFrom, sTo, {}, function(oError, sData) {
                    if (oError) {
                        syslog.error({action: 'KnoxedUp.moveFile', from: sFrom, to: sTo, error: oError});
                        fCallback(oError);
                    } else {
                        this._delete(sFrom, {}, function(oError) {
                            // Carry on even if delete didnt work - Error will be in the logs
                            fCallback(null, sData);
                        }.bind(this));
                    }
                }.bind(this));
            }
        }
    };

    KnoxedUp.prototype._checkHash = function(sHash, sCheckHash, fCallback) {
        if (sCheckHash !== null) {
            if (sHash !== sCheckHash) {
                var oError = new Error('File Hash Mismatch');
                syslog.error({
                    action: 'KnoxedUp._checkHash.error',
                    hash: {
                        check:  sCheckHash,
                        actual: sHash
                    },
                    error: oError
                });
                return fCallback(oError);
            }
        }

        fCallback(null, sHash);
    };

    /**
     *
     * @param {String}   sFile     Path to File to Download
     * @param {String}   sType     Binary or (?)
     * @param {String}   sCheckHash
     * @param {String|Function}   [sExtension]
     * @param {Function} [fCallback] - Path of Temp File
     */
    KnoxedUp.prototype.toTemp = function(sFile, sType, sCheckHash, sExtension, fCallback) {
        if (typeof sExtension == 'function') {
            fCallback         = sExtension;
            sExtension        = path.extname(sFile);
        }

        fCallback  = typeof fCallback       == 'function' ? fCallback        : function() {};
        sExtension = KnoxedUp._dotExtension(sExtension);

        var sTempFile  = fsX.getTmpSync() + sFile.split('/').pop();

        syslog.debug({action: 'KnoxedUp.toTemp', file: sFile, type: sType, extension: sExtension, temp: sTempFile, local: this.getLocalPath(sFile)});

        if (KnoxedUp.isLocal() && this._localFileExistsSync(sFile)) {
            this._fromTemp(this.getLocalPath(sFile), sCheckHash, sExtension, fCallback);
        } else {
            this._getCachedFile(sCheckHash, sExtension, function(oCachedError, sCachedFile) {
                if (sCachedFile) {
                    fCallback(null, sCachedFile, sCheckHash);
                } else {
                    this._toTemp(sTempFile, sFile, sType, sCheckHash, sExtension, fCallback);
                }
            }.bind(this));
        }
    };

    /**
     *
     * @param {String} sTempFile
     * @param {String} sCheckHash
     * @param {String} sExtension
     * @param {Function} fCallback
     * @private
     */
    KnoxedUp.prototype._fromTemp = function(sTempFile, sCheckHash, sExtension, fCallback) {
        var sTimer = syslog.timeStart('KnoxedUp._fromTemp');
        sExtension = KnoxedUp._dotExtension(sExtension);

        var oLockOpts = {
            retries:    300,
            wait:       100
        };

        async.auto({
            hash:              function(fAsyncCallback, oResults) { fsX.hashFile(sTempFile, fAsyncCallback)       },
            check:   ['hash',  function(fAsyncCallback, oResults) { this._checkHash (oResults.hash, sCheckHash, fAsyncCallback) }.bind(this)],
            copy:    ['hash',  function(fAsyncCallback, oResults) { fsX.copyFile(sTempFile,  fsX.getTmpSync() + oResults.hash + sExtension, fAsyncCallback) }],
            chmod:   ['copy',  function(fAsyncCallback, oResults) { fs.chmod(oResults.copy, 0777, fAsyncCallback) }]
        }, function(oError, oResults) {
            if (oError) {
                syslog.error({action: sTimer + '.error', input: sTempFile, error: oError});
                fCallback(oError);
            } else {
                syslog.timeStop(sTimer, {input: sTempFile, hash: oResults.hash, file: oResults.copy});
                fCallback(null, oResults.copy, oResults.hash);
            }
        });
    };

    KnoxedUp._dotExtension = function(sExtension) {
        if (sExtension
        &&  sExtension.length) {
            return '.' + sExtension.replace(/^\.+/g, '');
        }

        return sExtension;
    };

    KnoxedUp._getTmpCache = function() {
        return '/tmp/cameo/cache/';
    };

    /**
     *
     * @param {String} sHash
     * @param {String} sExtension
     * @param {Function} fCallback
     * @private
     */
    KnoxedUp.prototype._getCachedFile = function(sHash, sExtension, fCallback) {
        return fCallback(null, null);

        syslog.debug({action: 'KnoxedUp._getCachedFile', hash: sHash, extension: sExtension});

        sExtension = KnoxedUp._dotExtension(sExtension);

        var sCachedFile  = path.join(KnoxedUp._getTmpCache(), sHash + sExtension);
        var sDestination = path.join(fsX.getTmpSync(), sHash + sExtension);
        fs.exists(sCachedFile, function(bExists) {
            if (bExists) {
                syslog.debug({action: 'KnoxedUp._getCachedFile.exists'});
                fsX.hashFile(sCachedFile, function(oHashError, sFileHash) {
                    if (oHashError) {
                        syslog.debug({action: 'KnoxedUp._getCachedFile.hash.error', error: oHashError});
                        fCallback(oHashError);
                    } else if (sHash == sFileHash) {
                        syslog.debug({action: 'KnoxedUp._getCachedFile.match', cache: sCachedFile, file: sDestination});
                        fsX.copyFile(sCachedFile, sDestination, fCallback);
                    } else {
                        syslog.debug({action: 'KnoxedUp._getCachedFile.hash.mismatch'});
                        fCallback(null, null);
                    }
                }.bind(this));
            } else {
                syslog.debug({action: 'KnoxedUp._getCachedFile.gone'});
                fCallback(null, null);
            }
        }.bind(this));
    };

    /**
     *
     * @param {String} sFile
     * @param {Function} fCallback
     * @private
     */
    KnoxedUp.prototype._cacheFile = function(sFile, fCallback) {
        return fCallback(null, null);

        var sTimer = syslog.timeStart('KnoxedUp._cacheFile');

        fsX.mkdirP(KnoxedUp._getTmpCache(), 0777, function(oError, sPath) {
            if (oError) {
                fCallback(oError);
            } else {
                var sDestination = path.join(KnoxedUp._getTmpCache(), path.basename(sFile));
                fsX.copyFile(sFile, sDestination, function(oCopyError, oResult) {
                    if (oCopyError) {
                        fCallback(oCopyError);
                    } else {
                        syslog.timeStop(sTimer, {input: sFile, file: sFile});
                        fCallback(null);
                    }
                });
            }
        });
    };

    /**
     *
     * @param {String} sTempFile
     * @param {String} sFile
     * @param {String} sType
     * @param {String} sCheckHash
     * @param {String} sExtension
     * @param {Function} fCallback
     * @private
     */
    KnoxedUp.prototype._toTemp = function(sTempFile, sFile, sType, sCheckHash, sExtension, fCallback) {
        var sTimer      = syslog.timeStart('KnoxedUp._toTemp');
            sExtension  = KnoxedUp._dotExtension(sExtension);

        async.auto({
            get:             function(fAsyncCallback, oResults) { this.getFile(sFile, sTempFile, sType, fAsyncCallback) }.bind(this),
            move:  ['get',   function(fAsyncCallback, oResults) { fsX.moveFileToHashWithExtension(oResults.get, fsX.getTmpSync(), sExtension, fAsyncCallback) }],
            check: ['move',  function(fAsyncCallback, oResults) { this._checkHash (oResults.move.hash, sCheckHash, fAsyncCallback) }.bind(this)],
            cache: ['check', function(fAsyncCallback, oResults) { this._cacheFile(oResults.move.path, fAsyncCallback) }.bind(this)]
        }, function(oError, oResults) {
            if (oError) {
                syslog.error({action: sTimer + '.error', input: sTempFile, error: oError, hash: sCheckHash, results: oResults});
                fCallback(oError);
            } else {
                syslog.timeStop(sTimer, {input: sTempFile, hash: oResults.hash, file: oResults.move});

                if (KnoxedUp.isLocal()) {
                    this.localize(oResults.move.path, sFile, function() {
                        fCallback(null, oResults.move.path, oResults.move.hash);
                    });
                } else {
                    fCallback(null, oResults.move.path, oResults.move.hash);
                }

            }
        }.bind(this));
    };

    /**
     *
     * @param {String} sTempPath
     * @param {String} sFile
     * @param {String} sType
     * @param {Function} fCallback
     * @private
     */
    KnoxedUp.prototype._toTempNoCheck = function(sTempPath, sFile, sType, fCallback) {
        var sTimer    = syslog.timeStart('KnoxedUp._toTempNoCheck');

        var sTempFile = sTempPath + 'toTemp-' + Math.random().toString(36).substring(8) + '-';

        async.auto({
            get:             function(fAsyncCallback, oResults) { this.getFile(sFile, sTempFile, sType, fAsyncCallback) }.bind(this),
            move:  ['get',   function(fAsyncCallback, oResults) { fsX.moveFileToHash(oResults.get, fsX.getTmpSync(), fAsyncCallback) }]
        }, function(oError, oResults) {
            if (oError) {
                syslog.error({action: sTimer + '.error', input: sTempFile, error: oError, results: oResults});
                fCallback(oError);
            } else {
                syslog.timeStop(sTimer, {input: sTempFile, hash: oResults.hash, file: oResults.move});

                if (KnoxedUp.isLocal()) {
                    this.localize(oResults.move.path, sFile, function() {
                        fCallback(null, oResults.move.path, oResults.move.hash);
                    });
                } else {
                    fCallback(null, oResults.move.path, oResults.move.hash);
                }

            }
        }.bind(this));
    };

    /**
     *
     * @param {String}   sFile     Path to File to Download
     * @param {String}   sType     Binary or (?)
     * @param {Function} fCallback - Path of Temp File
     */
    KnoxedUp.prototype.toSha1 = function(sFile, sType, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback : function() {};
        sType     = sType || 'binary';

        if (KnoxedUp.isLocal() && this._localFileExistsSync(sFile)) {
            fsX.hashFile(this.getLocalPath(sFile), fCallback);
        } else {
            this.toTemp(sFile, sType, null, function(oError, sTempFile, sHash) {
                if (oError) {
                    fCallback(oError);
                } else {
                    fCallback(null, sHash);
                }
            }.bind(this));
        }
    };

    /**
     *
     * @param {Array}    aFiles    Array if file paths to download to temp
     * @param {String}   sType     Binary or (?)
     * @param {Function} fCallback Object of Temp Files with S3 file names as Key
     */
    KnoxedUp.prototype.filesToSha1 = function(aFiles, sType, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        var oTempFiles = {};
        async.forEach(aFiles, function (sFile, fCallbackAsync) {
            this.toSha1(sFile, sType, function(oError, sHash) {
                if (oError) {
                    fCallbackAsync(oError);
                } else {
                    oTempFiles[sFile] = sHash;
                    fCallbackAsync(null);
                }
            }.bind(this))
        }.bind(this), function(oError) {
            if (oError) {
                fCallback(oError);
            } else {
                fCallback(null, oTempFiles);
            }
        }.bind(this));
    };

    /**
     *
     * @param {Object}   oFiles    Object of file paths to download to temp with file hashes as the key
     * @param {String}   sType     Binary or (?)
     * @param {Function} fCallback Object of Temp Files with S3 file names as Key
     */
    KnoxedUp.prototype.filesToTemp = function(oFiles, sType, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        var aDownloads = [];
        for (var sHash in oFiles) {
            aDownloads.push({
                hash: sHash,
                file: oFiles[sHash]
            });
        }

        var oTempFiles = {};
        async.forEach(aDownloads, function (oFile, fCallbackAsync) {
            this.toTemp(oFile.file, sType, oFile.hash, function(oError, sTempFile) {
                if (oError) {
                    fCallbackAsync(oError);
                } else {
                    oTempFiles[oFile.hash] = sTempFile;
                    fCallbackAsync(null);
                }
            }.bind(this))
        }.bind(this), function(oError) {
            if (oError) {
                syslog.error({action: 'KnoxedUp.filesToTemp.error', error: oError});
            }

            fCallback(oError, oTempFiles);
        }.bind(this));
    };

    /**
     *
     * @param {String}      sTempPath  Path to Download files to
     * @param {String}      sPrefix    String to Search Bucket for
     * @param {String}      sType      Binary or (?)
     * @param {Function}    fCallback
     */
    KnoxedUp.prototype._filesToPathByPrefix = function(sTempPath, sPrefix, sType, fCallback) {
        this.getFileList(sPrefix, 1000, function (oError, aFiles) {
            async.map(aFiles, function (sFile, fCallbackAsync) {
                this._toTempNoCheck(sTempPath, sFile, sType, function (oToTempError, sPath, sHash) {
                    fCallbackAsync(oToTempError, sPath);
                });
            }.bind(this), fCallback);
        }.bind(this));
    };

    /**
     *
     * @param {String}      sPrefix    String to Search Bucket for
     * @param {Function}    fCallback
     */
    KnoxedUp.prototype.deleteByPrefix = function(sPrefix, fCallback) {
        if (sPrefix.indexOf('pending/89') != 0) {
            return fCallback(new Error('Only allowed for pending folder currently'));
        }

        this.getFileList(sPrefix, 100, function (oError, aFiles) {
            async.map(aFiles, this.deleteFile.bind(this), fCallback);
        }.bind(this));
    };

    /**
     *
     * @param {String}      sTempPath  Path to download files to
     * @param {String}      sPrefix    String to Search Bucket for
     * @param {String}      sType      Binary or (?)
     * @param {Function}    fCallback
     */
    KnoxedUp.prototype.concatFilesMatchingPrefix = function(sTempPath, sPrefix, sType, fCallback) {
        this._filesToPathByPrefix(sTempPath, sPrefix, sType, function(oError, aDownloadedFiles) {
            syslog.debug({action: 'KnoxedUp.concatFilesMatchingPrefix', path: sTempPath, prefix: sPrefix, type: sType, files: aDownloadedFiles});

            fsX.concat(sTempPath, aDownloadedFiles, fCallback);
        });
    };

    /**
     *
     * @param {Object}   oFiles    Object of file paths to download to temp with file hashes as the key
     * @param {String}   sType     Binary or (?)
     * @param {String}   sExtension
     * @param {Function} fCallback Object of Temp Files with S3 file names as Key
     */
    KnoxedUp.prototype.filesToTempWithExtension = function(oFiles, sType, sExtension, fCallback) {
        fCallback = typeof fCallback == 'function' ? fCallback  : function() {};

        var aDownloads = [];
        for (var sHash in oFiles) {
            aDownloads.push({
                hash: sHash,
                file: oFiles[sHash]
            });
        }

        var oTempFiles = {};
        async.eachLimit(aDownloads, this.oConfig.maxAsyncDownloads, function (oFile, fCallbackAsync) {
            this.toTemp(oFile.file, sType, oFile.hash, sExtension, function(oError, sTempFile) {
                if (oError) {
                    fCallbackAsync(oError);
                } else {
                    oTempFiles[oFile.hash] = sTempFile;
                    fCallbackAsync(null);
                }
            }.bind(this))
        }.bind(this), function(oError) {
            if (oError) {
                syslog.error({action: 'KnoxedUp.filesToTempWithExtension.error', error: oError});
            }

            fCallback(oError, oTempFiles);
        }.bind(this));
    };

    KnoxedUp.prototype.getLocalPath = function(sFile) {
        sFile = sFile !== undefined ? sFile : '';

        return path.join(KnoxedUp.sPath, this.oConfig.bucket, sFile);
    };

    KnoxedUp.isLocal = function() {
        return KnoxedUp.bLocal
            && KnoxedUp.sPath.length > 0;
    };

    KnoxedUp.setLocal = function(bLocal, sPath) {
        KnoxedUp.bLocal = bLocal;
        KnoxedUp.sPath  = sPath;
    };

    KnoxedUp.bLocal = false;
    KnoxedUp.sPath  = '';
