'use strict';

var fs = require('fs');
var path = require('path');
var async = require('async');

function readSizeRecursive(item, callback, ignoreRegEx = null, ignorePermissionsErrors = true) {
  var cb = callback;
  var ignoreRegExp = ignoreRegEx;
  var ignorePermErr = ignorePermissionsErrors

  fs.lstat(item, function lstat(e, stats) {
    var total = !e ? (stats.size || 0) : 0;

    if (!e && stats.isDirectory()) {
      fs.readdir(item, function readdir(err, list) {
        if (err) { return cb(err); }

        async.forEach(
          list,
          function iterate(dirItem, next) {
            readSizeRecursive(
              path.join(item, dirItem),
              function readSize(error, size) {
                if (!error) {
                  total += size;
                  return next();
                } else {
                  const code = error.code;
                  if (ignorePermissionsErrors == true && (code == 'EPERM' || code == 'EACCES')) {
                    next();
                  }
                  else {
                    next(error);
                  }
                }
              },
              ignoreRegExp,
              ignorePermErr
            );
          },
          function done(finalErr) {
            cb(finalErr, total);
          }
        );
      });
    } else {
      if (ignoreRegExp && ignoreRegExp.test(item)) {
        total = 0;
      }

      cb(e, total);
    }
  });
}

module.exports = readSizeRecursive;
