# extract-oracle.ps1
# 用本机 SQL*Plus 从 Oracle 源库抽取 DDL/PLSQL，输出到目录，供 hgdb-convert-studio 智能体转换。
#
# 用法：
#   .\extract-oracle.ps1 -Connection "scott/tiger@10.0.0.10:1521/ORCLPDB1" -Owner SCOTT -OutDir "D:\migration\src"
#
# 注意：
# - 需要本机安装 Oracle Client 且 sqlplus 在 PATH 中；
# - 连接串含密码，会出现在命令行/进程列表里，建议在受控环境使用；
# - 输出编码受 NLS_LANG 影响，转换前确认文件是 UTF-8 或 GBK 能被正确读取。

param(
  [Parameter(Mandatory = $true)][string]$Connection,
  [Parameter(Mandatory = $true)][string]$Owner,
  [Parameter(Mandatory = $true)][string]$OutDir
)

$ErrorActionPreference = 'Stop'

$sqlplus = Get-Command sqlplus -ErrorAction SilentlyContinue
if (-not $sqlplus) {
  throw "未找到 sqlplus。请安装 Oracle Client 并把 sqlplus 加入 PATH，或改用 expdp / SQL Developer / 现有导出文件。"
}

if (-not (Test-Path -LiteralPath $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

$script = Join-Path $PSScriptRoot 'oracle-extract.sql'
if (-not (Test-Path -LiteralPath $script)) {
  throw "找不到抽取脚本：$script"
}

Write-Host "== 抽取 $Owner -> $OutDir"
Write-Host "== 使用 $($sqlplus.Source)"

& $sqlplus.Source -S -L $Connection "@$script" $Owner $OutDir
$code = $LASTEXITCODE

if ($code -ne 0) {
  Write-Warning "sqlplus 退出码 $code，请检查输出与 $OutDir 下的文件。"
} else {
  Get-ChildItem -LiteralPath $OutDir -File | Select-Object Name, Length | Format-Table -AutoSize
  Write-Host "== 完成。下一步：让 hgdb-convert-studio 智能体转换该目录。"
}

exit $code