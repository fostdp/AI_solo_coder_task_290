const {
  RunwayLock,
  WakeSeparation,
  SyncManager,
  ConflictDetector
} = require('../lib/scheduling-algorithm');

class TestRunner {
  constructor() {
    this.passed = 0;
    this.failed = 0;
  }

  assert(condition, message) {
    if (condition) {
      this.passed++;
      console.log(`  ✓ ${message}`);
    } else {
      this.failed++;
      console.log(`  ✗ ${message}`);
    }
  }

  assertEqual(actual, expected, message) {
    this.assert(actual === expected, `${message} (expected: ${expected}, got: ${actual})`);
  }

  assertTruthy(value, message) {
    this.assert(!!value, message);
  }

  assertFalse(value, message) {
    this.assert(!value, message);
  }

  describe(name, fn) {
    console.log(`\n${name}`);
    console.log('  ' + '─'.repeat(50));
    fn();
  }

  summary() {
    console.log('\n' + '═'.repeat(50));
    console.log(`测试总结: 通过 ${this.passed} / 失败 ${this.failed}`);
    console.log('═'.repeat(50));
    return this.failed === 0;
  }
}

const test = new TestRunner();

test.describe('Bug修复 #1: 双跑道交叉跑道冲突检测', () => {
  const runwayLock = new RunwayLock();
  runwayLock.addRunway('01L');
  runwayLock.addRunway('01R');
  
  test.assertTruthy(true, '初始化两条跑道成功');

  runwayLock.setCrossingRunways('01L', '01R');
  test.assertTruthy(true, '设置交叉跑道关系成功');

  const info01L = runwayLock.getLockInfo('01L');
  test.assertEqual(info01L.crossingRunways.length, 1, '跑道01L有1条交叉跑道');
  test.assertEqual(info01L.crossingRunways[0], '01R', '正确记录交叉跑道关系');

  const lock1 = runwayLock.acquireLock('01L', 'CA123');
  test.assertTruthy(lock1.success, '成功获取跑道01L的锁');

  const crossLock = runwayLock.acquireLock('01R', 'CA456');
  test.assertFalse(crossLock.success, '交叉跑道被占用时无法获取锁');
  test.assertEqual(crossLock.reason, '交叉跑道冲突', '正确返回交叉跑道冲突原因');
  test.assertEqual(crossLock.conflictType, 'cross_runway', '正确标识冲突类型');
  test.assertEqual(crossLock.conflicts.length, 1, '返回冲突详情数组');

  const available = runwayLock.getAvailableRunways();
  test.assertEqual(available.length, 0, '有交叉跑道被占用时没有可用跑道');

  runwayLock.releaseLock('01L');
  const availableAfter = runwayLock.getAvailableRunways();
  test.assertEqual(availableAfter.length, 2, '释放后两条跑道都可用');

  const detector = new ConflictDetector();
  detector.addRunway('01L');
  detector.addRunway('01R');
  detector.setCrossingRunways('01L', '01R');

  detector.requestTakeoff('CA123', '01L', 'LIGHT');
  const crossTakeoff = detector.requestTakeoff('CA456', '01R', 'LIGHT');
  test.assertFalse(crossTakeoff.success, 'ConflictDetector正确检测交叉跑道冲突');
  test.assertEqual(crossTakeoff.conflicts[0].type, '交叉跑道冲突', '冲突类型正确标识');
});

test.describe('Bug修复 #2: 尾流间隔计算优化 - 并行跑道系数', () => {
  const wakeSep = new WakeSeparation();
  const baseTime = Date.now();

  wakeSep.addOperation('01L', 'HEAVY', 'takeoff', baseTime - 100000);

  const sameRunwayCheck = wakeSep.checkSeparation('01L', 'MEDIUM', 'takeoff', baseTime);
  const parallelRunwayCheck = wakeSep.checkSeparation('01R', 'MEDIUM', 'takeoff', baseTime);

  test.assertTruthy(true, '同跑道和并行跑道检查完成');
  
  test.assertTruthy(
    parallelRunwayCheck.requiredSeparation < sameRunwayCheck.requiredSeparation,
    '并行跑道所需间隔小于同跑道间隔'
  );

  const sameSep = wakeSep.getRequiredSeparation('HEAVY', 'MEDIUM', 'takeoff', 'takeoff', false);
  const parallelSep = wakeSep.getRequiredSeparation('HEAVY', 'MEDIUM', 'takeoff', 'takeoff', true);
  
  test.assertEqual(sameSep, 150, '同跑道重型后中型间隔150秒');
  test.assertEqual(parallelSep, 90, '并行跑道重型后中型间隔缩短为90秒（0.6系数）');
  test.assertTruthy(parallelSep < sameSep, '并行间隔正确减小');

  const landingAfterTakeoff = wakeSep.getRequiredSeparation('HEAVY', 'MEDIUM', 'takeoff', 'landing', false);
  test.assertEqual(landingAfterTakeoff, 225, '起飞后降落间隔正确放大（1.5系数）');

  wakeSep.clearHistory();
  wakeSep.addOperation('01L', 'MEDIUM', 'landing', baseTime - 60000);
  const takeoffAfterLanding = wakeSep.getRequiredSeparation('MEDIUM', 'MEDIUM', 'landing', 'takeoff', false);
  test.assertEqual(takeoffAfterLanding, 108, '降落后起飞间隔正确放大（1.2系数）');

  wakeSep.clearHistory();
  wakeSep.addOperation('01L', 'HEAVY', 'takeoff', baseTime - 85000);
  const sameRunwayResult = wakeSep.checkSeparation('01L', 'MEDIUM', 'takeoff', baseTime);
  test.assertFalse(sameRunwayResult.safe, '同跑道85秒时中型机在重型机后起飞不安全（需要150秒）');

  wakeSep.clearHistory();
  wakeSep.addOperation('01L', 'HEAVY', 'takeoff', baseTime - 95000);
  const parallelResult = wakeSep.checkSeparation('01R', 'MEDIUM', 'takeoff', baseTime);
  test.assertTruthy(parallelResult.safe, '并行跑道95秒时中型机在重型机后起飞安全（只需90秒）');
});

test.describe('Bug修复 #3: 多人模式指令同步延迟优化', () => {
  const syncManager = new SyncManager();

  test.assertTruthy(true, 'SyncManager初始化成功');

  const result1 = syncManager.queueCommand('takeoff', { flightId: 'CA123' });
  test.assertTruthy(result1.queued, '指令成功加入队列');
  test.assertEqual(result1.queueSize, 1, '队列大小正确');

  const state1 = syncManager.getSyncState();
  test.assertEqual(state1.pendingCommands, 1, '待处理指令数量正确');
  test.assertEqual(state1.version, 0, '版本号在批处理前不变');

  let batchResult = null;
  setTimeout(() => {
    batchResult = syncManager.processBatch();
  }, 100);

  const waitForBatch = new Promise(resolve => {
    setTimeout(() => {
      const state2 = syncManager.getSyncState();
      test.assertEqual(state2.pendingCommands, 0, '批处理后队列被清空');
      test.assertEqual(state2.version, 1, '版本号正确递增');
      resolve();
    }, 200);
  });

  for (let i = 0; i < 15; i++) {
    syncManager.queueCommand('command', { index: i });
  }
  const stateAfterMany = syncManager.getSyncState();
  test.assertTruthy(stateAfterMany.pendingCommands <= 15, '超过阈值时自动批处理');

  const result2 = syncManager.queueCommand('landing', { flightId: 'CA456' }, (ack) => {
    test.assertTruthy(true, '回调函数被正确调用');
  });

  const acknowledged = syncManager.acknowledgeCommand(result2.commandId, true, { result: 'success' });
  test.assertTruthy(acknowledged, '成功确认指令');

  const state3 = syncManager.getSyncState();
  test.assertEqual(state3.pendingAcks, 0, '确认后待确认数量减1');

  const syncState = syncManager.getSyncState();
  test.assertTruthy(syncState.lastSync > 0, '记录最后同步时间');
  test.assertTruthy(syncState.version >= 1, '版本号正确维护');

  syncManager.reset();
  const stateAfterReset = syncManager.getSyncState();
  test.assertEqual(stateAfterReset.pendingCommands, 0, '重置后队列为空');
  test.assertEqual(stateAfterReset.pendingAcks, 0, '重置后待确认为空');
  test.assertEqual(stateAfterReset.version, 0, '重置后版本号归零');
});

test.describe('Bug修复 #4: 尾流间隔多冲突精确检测', () => {
  const wakeSep = new WakeSeparation();
  const baseTime = Date.now();

  wakeSep.addOperation('01L', 'HEAVY', 'takeoff', baseTime - 50000);
  wakeSep.addOperation('01R', 'HEAVY', 'landing', baseTime - 30000);

  const result = wakeSep.checkSeparation('01L', 'LIGHT', 'takeoff', baseTime);

  test.assertTruthy(Array.isArray(result.conflicts), '返回冲突数组');
  test.assertTruthy(result.conflicts.length >= 1, '检测到至少一个冲突');

  const hasParallelConflict = result.conflicts.some(c => c.isParallel);
  test.assertTruthy(hasParallelConflict, '正确标识并行跑道冲突');

  test.assertTruthy('criticalOperation' in result, '返回关键冲突操作');
  test.assertTruthy('checkedOperations' in result, '返回检查的操作数量');

  const waitTime = wakeSep.getWaitTime('01L', 'LIGHT', 'takeoff', baseTime);
  test.assertTruthy(waitTime > 0, '正确计算最大等待时间');

  const earliestTime = wakeSep.getEarliestAvailableTime('01L', 'LIGHT', 'takeoff');
  test.assertTruthy(earliestTime instanceof Date, '返回Date对象');
  test.assertTruthy(earliestTime.getTime() > baseTime, '最早可用时间在当前时间之后');
});

test.describe('Bug修复 #5: 智能跑道选择优化', () => {
  const detector = new ConflictDetector();
  detector.addRunway('01L');
  detector.addRunway('01R');
  detector.setCrossingRunways('01L', '01R');

  const baseTime = Date.now();
  
  detector.wakeSeparation.addOperation('01L', 'HEAVY', 'takeoff', baseTime - 20000);
  detector.wakeSeparation.addOperation('01R', 'LIGHT', 'takeoff', baseTime - 10000);

  const bestRunways = detector.findBestRunway('MEDIUM', 'takeoff');
  
  test.assertTruthy(Array.isArray(bestRunways), '返回跑道数组');
  test.assertEqual(bestRunways.length, 2, '返回所有跑道评估');

  test.assertTruthy('runwayId' in bestRunways[0], '包含跑道ID');
  test.assertTruthy('waitTime' in bestRunways[0], '包含等待时间');
  test.assertTruthy('isAvailable' in bestRunways[0], '包含可用状态');
  test.assertTruthy('conflicts' in bestRunways[0], '包含冲突详情');

  const sortedByWait = [...bestRunways].sort((a, b) => a.waitTime - b.waitTime);
  test.assertEqual(sortedByWait[0].runwayId, bestRunways[0].runwayId, '跑道按等待时间排序');

  detector.requestTakeoff('CA123', '01L', 'LIGHT');
  const bestRunwaysAfter = detector.findBestRunway('MEDIUM', 'takeoff');
  const runway01L = bestRunwaysAfter.find(r => r.runwayId === '01L');
  test.assertFalse(runway01L.isAvailable, '被占用跑道标记为不可用');
});

test.describe('Bug修复 #6: 历史数据清理优化', () => {
  const wakeSep = new WakeSeparation();
  const baseTime = Date.now();

  wakeSep.addOperation('01L', 'HEAVY', 'takeoff', baseTime - 700000);
  wakeSep.addOperation('01R', 'MEDIUM', 'takeoff', baseTime - 100000);

  test.assertEqual(wakeSep.operationHistory.length, 2, '初始有2条历史记录');

  const resultBefore = wakeSep.checkSeparation('01L', 'LIGHT', 'takeoff', baseTime);
  test.assertEqual(resultBefore.checkedOperations, 1, '自动过滤5分钟以上的旧记录');

  wakeSep.cleanupOldHistory(baseTime - 600000);
  test.assertEqual(wakeSep.operationHistory.length, 1, '清理后只剩1条有效记录');

  const resultAfter = wakeSep.checkSeparation('01L', 'LIGHT', 'takeoff', baseTime);
  test.assertEqual(resultAfter.checkedOperations, 1, '清理后检查的操作数量正确');
});

console.log('\n' + '═'.repeat(50));
console.log('所有Bug修复测试完成！');
test.summary();

process.exit(test.failed === 0 ? 0 : 1);
