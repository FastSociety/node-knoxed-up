#!/usr/bin/make -f

all:
	npm install --production
	
install:
	mkdir -p $(DESTDIR)/usr/lib/node_modules/knoxed-up
	cp -a aws-s3.js knoxed-up.js node_modules package.json $(DESTDIR)/usr/lib/node_modules/knoxed-up