TARGET_DIR=$(INSTALL_DIR)/sdksrvd

all: build 

build: 
	test -e node_modules || npm install

install:
	rm -rf $(TARGET_DIR)
	mkdir -p $(TARGET_DIR)
	cp *.js *.json node_modules $(TARGET_DIR)/ -r