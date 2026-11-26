# 全平台原生速度方案（详细版）

目标：用户只执行 `bun i -g <包名>`，不需要知道自己是什么平台，之后每次运行命令
都是直接启动 Rust 二进制，中间不经过 bun 或 node。

状态：Linux 和 macOS 的做法已实现，并在 Linux x64 上端到端验证过。Windows 的做法
（第 3 节）和公开仓库后的结构（第 4 节）是设计，尚未实现。

## 1. 为什么这件事难

一个 npm 包的 `bin` 在所有平台上指向同一个文件，而各平台对这个文件的要求互相冲突：

| 平台 | 命令是怎么启动的 | 文件必须是什么 |
|---|---|---|
| Linux / macOS | 包管理器建一个软链接，内核直接执行目标文件 | 以 `#!` 开头的脚本，或原生可执行文件 |
| Windows | 包管理器在**安装时**读目标文件，生成一个启动器（shim） | 有 `#!` 行：shim 绑定到 bun/node；没有：shim 直接执行它，所以它必须已经是 PE 文件 |

所以同一个文件不可能既让 Unix 内核能执行（必须以 `#!` 开头），又让 Windows 直接
执行（必须以 `MZ` 开头）。成熟项目的解法都是在 postinstall 里把占位文件换成二进
制，而 `bun i -g` 不执行依赖的 postinstall（本机 bun 1.4.0 实测：静默跳过）。

## 2. Linux / macOS：已实现

1. 主包里的命令文件是一个带 `#!/usr/bin/env bun` 的小启动器，没有安装脚本。
2. 第一次运行时，启动器把平台包里的原生二进制硬链接到自己的位置（原子替换），
   同一个包的其他命令名也一起替换。
3. 从第二次运行开始，`~/.bun/bin/<命令>` 这个软链接指向的就是原生二进制本身。

实测（Linux x64，30 次平均）：直接运行二进制 1.5 ms；`bun i -g` 安装后第二次起
1.4 ms；每次都走 bun 启动器 23 ms；每次都走 node 20 启动器 145 ms。

升级后包目录被整体替换，第一次运行重新链接，不会残留旧版本（已测）。

## 3. Windows：方案

### 3.1 bun 在 Windows 上实际做了什么

读的是 bun 源码（`src/install/bin.rs`、`src/install/windows-shim/`，对应 1.4.5）：

- 每个命令生成两个文件：`<命令>.exe`（所有命令共用的一个很小的原生 shim）和
  `<命令>.bunx`（元数据：目标路径，以及要不要先启动 bun/node）。
- 目标文件有 `#!` 行时，`.bunx` 记录 "用 bun 运行它"；没有 `#!` 且扩展名不是
  js/ts/cmd/ps1 时，`.bunx` 记录 "直接执行"。
- 每次安装或升级，bun 都会重写 `.bunx`。`.exe` 如果正在运行（EBUSY）就跳过。

由此得出两个结论：

- **不能替换 `<命令>.exe`。** 如果把它换成原生二进制，而升级时它正在运行，bun 会
  跳过它，旧版本的二进制就永远留在那里。
- **可以改写 `<命令>.bunx`。** 它每次安装都会被 bun 重写，所以不会残留旧状态。

### 3.2 做法

第一次运行（仍然经过启动器，只有这一次）：

1. 启动器把原生二进制硬链接到主包的 `bin\<命令>.exe`（这一步已实现）。
2. **bun 安装的**：读取 `<命令>.bunx`，严格校验它是已知格式（版本标记 V5、带
   shebang、目标是本包的启动器），然后改写成 "直接执行 `bin\<命令>.exe`"。
   校验不通过就不改，继续走启动器，功能不受影响。
3. **npm 安装的**：把前缀目录里的 `<命令>.cmd`、`<命令>.ps1`、`<命令>` 三个文本
   shim 改写成直接调用 `bin\<命令>.exe`。同样先校验内容确实指向本包。

之后的启动链：bun 的 shim → 原生二进制。这和 bun 在 Windows 上安装任何原生工具
（包括 bun 对 claude-code 的特殊处理）得到的结果一样，没有 JS 运行时。

升级和卸载：`.bunx` 和 npm 的 shim 都由包管理器重新生成或删除，指向的是包目录内
的文件，所以不会出现版本错位或卸载后残留命令。

### 3.3 风险

- `.bunx` 是 bun 的内部格式，没有文档承诺。应对：只在版本标记完全匹配时改写；
  CI 在 Windows runner 上用最新 bun 跑冒烟测试，格式一变测试就会失败。
- 我无法在本机验证任何 Windows 行为。在 CI 的 Windows runner 上跑通之前，这部分
  只能算设计。

### 3.4 考虑过但不采用的做法

| 做法 | 不采用的原因 |
|---|---|
| 占位 `.exe` + postinstall（claude-code、bun、opencode 的做法） | `bun i -g` 不跑 postinstall，装完是坏的，要用户手动 `bun pm -g trust` |
| 一个文件同时是 PE 和 shell 脚本（多语言文件） | Unix 上首次运行依赖 shell 的回退机制；Docker exec 形式、systemd、Rust/Go/Python 直接拉起都会失败 |
| 替换 bun 的 `<命令>.exe` | 见 3.1：升级时若正在运行，会永久残留旧版本 |
| bun 的 `nativeDependencies`（bun 自带的原生链接优化，默认只对 esbuild 和 claude-code 生效） | 要改每台机器的全局 package.json；没有文档；本机 bun 1.4.0 实测不生效 |

## 4. 仓库公开之后的结构

现在的做法是把脚本和 workflow 复制进每个项目。仓库公开后改成各项目引用这里：

```yaml
# 各项目里的 .github/workflows/release.yml，大约 20 行
jobs:
  build:
    uses: snomiao/rustify/.github/workflows/rust-npm-build.yml@v1
    with:
      manifest: rs/Cargo.toml
      bins: slack
      smoke: slack --version
      version: ${{ inputs.version }}
  publish:
    needs: build
    if: inputs.publish
    runs-on: ubuntu-latest
    permissions: { id-token: write }
    steps:
      - uses: snomiao/rustify/actions/publish@v1
```

- **构建、打包、冒烟测试**放在 rustify 的可复用 workflow 里。平台列表只存在于
  rustify 一处，加平台或修启动器只改这里，各项目不用动。
- **发布**这一步留在各项目自己的 job 里，用 rustify 提供的 composite action。这
  样申请 npm 发布凭证的始终是项目自己的 workflow。npm 文档写明：经可复用
  workflow 发布时，校验的是调用方 workflow 的文件名。
- **rustify 自测**：rustify 自己的 CI 用测试用的小二进制跑完整流程——六个平台
  构建、打包、在 Linux / macOS / Windows 的 x64 和 arm64 真机上用 bun 和 npm 安装
  并运行。公开仓库的 runner 免费。这一步会把目前 "未验证" 的项目全部变成有据可
  查：workflow 本身、macOS、Windows 启动器、Windows 的 shim 改写、musl 交叉编译。
  它不向 npm 发布任何东西。

公开前检查过将要公开的内容：没有密钥或令牌；四个被迁移的项目本身都是公开仓库；
文档里有本机路径（`/code/snomiao/...`）和 agent-yes 一个分支名，无敏感信息。

## 5. 执行顺序

1. 提交现有内容，推送，把仓库设为公开。
2. 实现 Windows 的 shim 改写（启动器内），附格式转换的单元测试。
3. 把 workflow 拆成可复用 workflow + 发布 action，加 rustify 自测 CI。
4. 反复跑自测直到六个平台全绿；失败就修，尤其是 Windows。
5. 打 `v1` 标签。
6. 第一个接入的项目：slack-hub（分支干净、Rust 部分小）。接入方式见
   `docs/npm-distribution.md` 的过渡期一节：Rust 二进制作为入口，未移植的命令交
   还给现有 JS。
7. slack-hub 用 PR 跑通（只构建和冒烟，不发布）后，由你决定何时真正发布。

第 1 步和第 7 步的发布需要你明确同意；其余我可以连续做完。

## 6. 仍然做不到的

- Windows 上用 pnpm 或 yarn 全局安装的：保持启动器（能用，每次启动多一次 bun 启动）。
- 任何平台的第一次运行都要经过一次启动器（约 20–30 ms，仅一次）。
- 包目录只读时无法链接，一直走启动器，功能正常。
