// 测试创建实例并验证自定义脚本
const Database = require('better-sqlite3');

async function main() {
  const db = new Database('/app/data/cloudpanel.db');
  
  // 获取用户信息
  const user = db.prepare('SELECT id FROM users WHERE is_admin = 1').get();
  console.log('👤 用户ID:', user.id);
  
  // 获取DigitalOcean密钥
  const doKey = db.prepare('SELECT id, name FROM api_keys WHERE provider = ? AND user_id = ?')
    .get('digitalocean', user.id);
  
  if (!doKey) {
    console.log('❌ 未找到DigitalOcean密钥，尝试Linode...');
    const linodeKey = db.prepare('SELECT id, name FROM api_keys WHERE provider = ? AND user_id = ?')
      .get('linode', user.id);
    
    if (!linodeKey) {
      console.log('❌ 未找到任何可用的API密钥');
      process.exit(1);
    }
    
    console.log('✅ 使用Linode密钥:', linodeKey.name);
    await testLinodeInstance(db, user.id, linodeKey.id);
  } else {
    console.log('✅ 使用DigitalOcean密钥:', doKey.name);
    await testDOInstance(db, user.id, doKey.id);
  }
}

async function testDOInstance(db, userId, keyId) {
  // 设置session
  db.prepare('UPDATE sessions SET selected_api_key_id = ? WHERE user_id = ?')
    .run(keyId, userId);
  
  const testScript = `#!/bin/bash
# CloudPanel自动配置脚本
echo "开始执行CloudPanel自动配置脚本..."

# 设置root密码
echo 'root:Test123456!' | chpasswd

# 启用SSH root登录
sed -i 's/^#\\?PermitRootLogin.*/PermitRootLogin yes/g' /etc/ssh/sshd_config
sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication yes/g' /etc/ssh/sshd_config
rm -rf /etc/ssh/sshd_config.d/* 2>/dev/null || true
systemctl restart sshd 2>/dev/null || service ssh restart 2>/dev/null || true

echo "系统初始化配置完成"

# ====== 用户自定义脚本 ======
echo "开始执行用户自定义脚本..."
echo "测试脚本正在执行 - $(date)" > /root/custom_test.txt
apt-get update -y
apt-get install -y curl wget htop
echo "自定义脚本执行完成" >> /root/custom_test.txt
echo "用户自定义脚本执行完成"

echo "CloudPanel自动配置脚本执行完成"
`;

  console.log('\n📝 测试脚本信息:');
  console.log('  - 脚本长度:', testScript.length);
  console.log('  - 包含自定义内容:', testScript.includes('custom_test.txt'));
  
  const createData = {
    name: `do-test-${Date.now().toString().slice(-6)}`,
    region: 'nyc3',
    plan: 's-1vcpu-512mb-10gb',
    image: 'ubuntu-22-04-x64',
    root_password: 'Test123456!',
    user_data: testScript,
    enableIPv6: false
  };
  
  console.log('\n🚀 创建DigitalOcean测试实例:');
  console.log('  - 名称:', createData.name);
  console.log('  - 区域:', createData.region);
  console.log('  - 配置:', createData.plan);
  console.log('  - 镜像:', createData.image);
  console.log('  - user_data长度:', createData.user_data.length);
  
  console.log('\n⏳ 请查看Docker日志以验证user_data是否传递...');
  console.log('docker logs cloudpanel 2>&1 | grep -A 10 "DigitalOcean.*创建实例"');
}

async function testLinodeInstance(db, userId, keyId) {
  // 设置session
  db.prepare('UPDATE sessions SET selected_api_key_id = ? WHERE user_id = ?')
    .run(keyId, userId);
  
  const testScript = `#!/bin/bash
# CloudPanel自动配置脚本
echo "开始执行CloudPanel自动配置脚本..."

# 设置root密码
echo 'root:Test123456!' | chpasswd

# 启用SSH root登录
sed -i 's/^#\\?PermitRootLogin.*/PermitRootLogin yes/g' /etc/ssh/sshd_config
sed -i 's/^#\\?PasswordAuthentication.*/PasswordAuthentication yes/g' /etc/ssh/sshd_config
rm -rf /etc/ssh/sshd_config.d/* 2>/dev/null || true
systemctl restart sshd 2>/dev/null || service ssh restart 2>/dev/null || true

echo "系统初始化配置完成"

# ====== 用户自定义脚本 ======
echo "开始执行用户自定义脚本..."
echo "测试脚本正在执行 - $(date)" > /root/custom_test.txt
apt-get update -y
apt-get install -y curl wget htop
echo "自定义脚本执行完成" >> /root/custom_test.txt
echo "用户自定义脚本执行完成"

echo "CloudPanel自动配置脚本执行完成"
`;

  console.log('\n📝 测试脚本信息:');
  console.log('  - 脚本长度:', testScript.length);
  console.log('  - 包含自定义内容:', testScript.includes('custom_test.txt'));
  
  const createData = {
    name: `ln-test-${Date.now().toString().slice(-6)}`,
    region: 'us-east',
    plan: 'g6-nanode-1',
    image: 'linode/ubuntu22.04',
    root_password: 'Test123456!',
    user_data: testScript,
    enableIPv6: false
  };
  
  console.log('\n🚀 创建Linode测试实例:');
  console.log('  - 名称:', createData.name);
  console.log('  - 区域:', createData.region);
  console.log('  - 配置:', createData.plan);
  console.log('  - 镜像:', createData.image);
  console.log('  - user_data长度:', createData.user_data.length);
  
  console.log('\n⏳ 请查看Docker日志以验证StackScript是否创建...');
  console.log('docker logs cloudpanel 2>&1 | grep -A 10 "Linode.*StackScript"');
}

main().catch(console.error);
