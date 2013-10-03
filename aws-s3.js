    var fs          = require('fs');
    var path        = require('path');
    var util        = require('util');
    var AwsSdk      = require('aws-sdk');
    var fsX         = require('fs-extended');
    var xml2js      = require('xml2js');
    var async       = require('async');
    var Buffer      = require('buffer').Buffer;
    var syslog      = require('syslog-console').init('aws-s3');

    var AwsS3 = function(oConfig) {
        if (oConfig.AMAZON !== undefined) 
        {
            AwsSdk.config.update({accessKeyId: oConfig.AMAZON.SERVER.ID, secretAccessKey: oConfig.AMAZON.SERVER.SECRET});
            this.bucket = oConfig.AMAZON.BUCKET;
            this.ssl = oConfig.secure;
            this.port = oConfig.port;

            if (oConfig.AMAZON.LOCAL       !== undefined
            &&  oConfig.AMAZON.LOCAL_PATH  !== undefined) 
            {
                AwsS3.local = oConfig.AMAZON.LOCAL;
                AwsS3.localPath = oConfig.AMAZON.LOCAL_PATH;
            }
        }
        else if (oConfig.key !== undefined) {
            AwsSdk.config.update({accessKeyId: oConfig.key, secretAccessKey: oConfig.secret});
            this.bucket = oConfig.bucket
        }
        this.S3 = new AwsSdk.S3();
    };

    AwsS3.prototype.putStream = function(sFrom, sTo, oHeaders, fCallback, iRetries) {
        fs.readFile(sFrom, function (err, data) {
            if (err !== undefined && err !== null) {
                fCallback(err, null);
            }
            else {
                this.S3.putObject({Bucket: this.bucket, Key: sTo, Body: data}, function (err, data) {
                    if (err !== undefined && err !== null) {
                        fCallback(err, null);
                    }       
                    else {
                        fCallback(null, sTo);
                    }
                });
            }
        }.bind(this));
    }

    AwsS3.prototype.getFile = function(sFromFile, sToFile, callback)
    {   
        this.S3.getObject({Bucket: this.bucket, Key: sFromFile}, function(err, obj)
            {
                if (obj == null || obj.Body == null) {
                    callback(err, null);
                }
                else {
                    var fd =  fs.openSync(sToFile, 'w');
                    var buff = new Buffer(obj.Body, 'base64');
                    fs.write(fd, buff, 0, buff.length, 0, function(err,written){
                        callback(err, sToFile);  
                    });
                }
                
            });
    };

    module.exports = AwsS3;