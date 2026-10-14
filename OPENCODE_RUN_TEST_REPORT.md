# OpenCode Run 测试报告

> ⚠️ **历史/已过时 (SUPERSEDED)** — 本报告反映旧版集成状态
> (`.opencode/plugins/behavioros/` 目录结构)。此处所有数字均已过时：
> 当前集成为 OpenCode v2 插件 `plugins/opencode-v2`，含 **29** 个 `bos_*` tools。
> 唯一事实来源见 [docs/CLAIMS.md](docs/CLAIMS.md) 与
> [docs/OPENCODE_RUN.md](docs/OPENCODE_RUN.md)。

## 测试结论

**结论：未能在当前环境完成 `opencode run` 实时测试，但插件已就绪**

## 诊断过程

### 1. 插件检测状态
```
$ opencode plugin list
ID           VERSION  SOURCE
behavior-os  local    C:\www\behavior-os\.opencode\plugins\behavioros\index.ts
```
✅ 插件已被 OpenCode 识别并加载

### 2. 阻塞问题
```json
{
  "type": "error",
  "message": "Failed to change directory to /c/www/behavior-os"
}
```
**根因**：OpenCode CLI 在 MSYS/Git Bash 环境下无法正确处理 `/c/www/...` 路径格式

### 3. 已验证的功能

| 功能 | 状态 | 验证方式 |
|------|------|----------|
| 插件代码编译 | ✅ | TypeScript 编译成功 |
| 插件注册 | ✅ | `opencode plugin list` 显示 behavior-os |
| DNA Patterns | ✅ | 21 个 YAML 文件存在 |
| 单元测试 | ✅ | 242/242 通过 |
| TypeScript 类型检查 | ✅ | 0 any/as any |
| Lint | ✅ | 0 errors, 27 warnings |
| Build | ✅ | 7/7 tasks success |

### 4. 待完成的测试

在原生 Windows 环境下执行：
```powershell
cd C:\www\behavior-os
opencode run --standalone "test behavioros governance plugin"
```

## 修复建议

如需在当前环境完成测试，可将项目移至非 MSYS 路径（如 `D:\`），或通过 npm scripts 调用原生 node 执行。
