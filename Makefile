# Makefile for the Appointment Checker project

.PHONY: all build build-linux run clean

# --- Variables ---
OUTPUT_DIR=output
BINARY_NAME=appointment-checker
LINUX_BINARY_NAME=$(BINARY_NAME)-linux-x64

# --- Targets ---

all: build

# 编译为当前平台的可执行文件
build: $(OUTPUT_DIR)/$(BINARY_NAME)

$(OUTPUT_DIR)/$(BINARY_NAME):
	@mkdir -p $(OUTPUT_DIR)
	@echo "📦 Building binary for current platform..."
	@bun build src/index.ts --compile --outfile $@
	@echo "✅ Build complete: $@"

# 交叉编译为 Linux x86_64 平台的可执行文件
build-linux: $(OUTPUT_DIR)/$(LINUX_BINARY_NAME)

$(OUTPUT_DIR)/$(LINUX_BINARY_NAME):
	@mkdir -p $(OUTPUT_DIR)
	@echo "📦 Cross-compiling binary for Linux x86_64..."
	@bun build src/index.ts --compile --target=bun-linux-x86_64 --outfile $@
	@echo "✅ Build complete: $@"
	@echo "\n🕵️  Verifying binary architecture..."
	@file $@

# 使用 bun 直接运行项目 (用于本地开发)
run:
	@echo "🚀 Running in development mode..."
	@bun run src/index.ts

# 清理编译产物
clean:
	@echo "🧹 Cleaning up build artifacts..."
	@rm -rf $(OUTPUT_DIR)
	@rm -rf dist/
	@rm -f .*.bun-build
	@echo "✅ Cleanup complete."
