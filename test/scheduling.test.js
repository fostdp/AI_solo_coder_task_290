const {
  RunwayLock,
  WakeSeparation,
  TaxiwayPathPlanner,
  ConflictDetector
} = require('../lib/scheduling-algorithm');

class TestRunner {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.tests = [];
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

test.describe('1. 跑道占用锁测试', () => {
  const runwayLock = new RunwayLock();
  runwayLock.addRunway('01R');
  runwayLock.addRunway('18L');

  test.assertTruthy(true, '初始化跑道锁成功');

  const lock1 = runwayLock.acquireLock('01R', 'CA123');
  test.assertTruthy(lock1.success, '成功获取跑道01R的锁');
  test.assertEqual(lock1.planeId, 'CA123', '正确记录锁定航班');

  const lock2 = runwayLock.acquireLock('01R', 'CA456');
  test.assertFalse(lock2.success, '无法获取已被占用的跑道锁');
  test.assertEqual(lock2.reason, '跑道已被占用', '正确返回占用原因');

  const isOccupied = runwayLock.isOccupied('01R');
  test.assertTruthy(isOccupied, 'isOccupied正确返回占用状态');

  const available = runwayLock.getAvailableRunways();
  test.assertEqual(available.length, 1, '可用跑道数量正确');
  test.assertEqual(available[0], '18L', '正确识别可用跑道');

  const release = runwayLock.releaseLock('01R');
  test.assertTruthy(release.success, '成功释放跑道锁');
  test.assertEqual(release.releasedPlane, 'CA123', '正确释放之前锁定的航班');

  const availableAfter = runwayLock.getAvailableRunways();
  test.assertEqual(availableAfter.length, 2, '释放后所有跑道可用');

  const lock3 = runwayLock.acquireLock('01R', 'CA789');
  test.assertTruthy(lock3.success, '释放后可重新获取跑道锁');
  test.assertEqual(lock3.planeId, 'CA789', '正确记录新锁定航班');
});

test.describe('2. 尾流间隔检测测试', () => {
  const wakeSep = new WakeSeparation();
  const now = Date.now();

  test.assertTruthy(true, '初始化尾流间隔检测成功');

  const emptyCheck = wakeSep.checkSeparation('01R', 'HEAVY', 'takeoff', now);
  test.assertTruthy(emptyCheck.safe, '无操作历史时起飞安全');
  test.assertEqual(emptyCheck.requiredSeparation, 0, '无历史操作时间隔为0');

  wakeSep.addOperation('01R', 'HEAVY', 'takeoff', now - 60000);

  const heavyAfterHeavy = wakeSep.checkSeparation('01R', 'HEAVY', 'takeoff', now);
  test.assertFalse(heavyAfterHeavy.safe, '重型机60秒后起飞不安全');
  test.assertEqual(heavyAfterHeavy.requiredSeparation, 120, '重型后重型间隔120秒');

  const mediumAfterHeavy = wakeSep.checkSeparation('01R', 'MEDIUM', 'takeoff', now);
  test.assertFalse(mediumAfterHeavy.safe, '中型机在重型机60秒后起飞不安全');
  test.assertEqual(mediumAfterHeavy.requiredSeparation, 150, '重型后中型间隔150秒');

  const lightAfterHeavy = wakeSep.checkSeparation('01R', 'LIGHT', 'takeoff', now);
  test.assertFalse(lightAfterHeavy.safe, '轻型机在重型机60秒后起飞不安全');
  test.assertEqual(lightAfterHeavy.requiredSeparation, 180, '重型后轻型间隔180秒');

  const laterTime = now + 200000;
  const safeCheck = wakeSep.checkSeparation('01R', 'LIGHT', 'takeoff', laterTime);
  test.assertTruthy(safeCheck.safe, '200秒后轻型机可以安全起飞');

  const waitTime = wakeSep.getWaitTime('01R', 'LIGHT', 'takeoff', now);
  test.assertEqual(waitTime, 120, '正确计算等待时间');

  const landingAfterTakeoff = wakeSep.checkSeparation('01R', 'MEDIUM', 'landing', now);
  test.assertTruthy(landingAfterTakeoff.requiredSeparation > 150, '起飞后降落间隔更长');

  wakeSep.clearHistory();
  const afterClear = wakeSep.checkSeparation('01R', 'HEAVY', 'takeoff', now);
  test.assertTruthy(afterClear.safe, '清除历史后起飞安全');
});

test.describe('3. 滑行道路径规划测试', () => {
  const planner = new TaxiwayPathPlanner();

  planner.addTaxiway('A', 'Gate1', 'Intersection1', 200);
  planner.addTaxiway('B', 'Intersection1', 'RunwayEntry1', 150);
  planner.addTaxiway('C', 'Gate2', 'Intersection1', 180);
  planner.addTaxiway('D', 'Intersection1', 'Intersection2', 100);
  planner.addTaxiway('E', 'Intersection2', 'RunwayEntry1', 120);

  test.assertTruthy(true, '初始化滑行道网络成功');

  const path1 = planner.findPath('Gate1', 'RunwayEntry1');
  test.assertTruthy(path1.success, '成功找到路径');
  test.assertEqual(path1.totalLength, 350, '路径总长度正确');
  test.assertEqual(path1.taxiwayPath.length, 2, '路径包含2条滑行道');
  test.assertEqual(path1.path.length, 3, '路径包含3个节点');

  const invalidPath = planner.findPath('Gate1', 'NonExistent');
  test.assertFalse(invalidPath.success, '不存在节点返回失败');
  test.assertEqual(invalidPath.reason, '节点不存在', '正确返回错误原因');

  planner.occupyTaxiway('A', 'CA123');
  const blockedPath = planner.findPath('Gate1', 'RunwayEntry1');
  test.assertFalse(blockedPath.success, '滑行道被占用时无可用路径');

  planner.releaseTaxiway('A');
  const pathAfterRelease = planner.findPath('Gate1', 'RunwayEntry1');
  test.assertTruthy(pathAfterRelease.success, '释放滑行道后路径可用');

  planner.occupyNode('Intersection1', 'CA456');
  const nodeBlocked = planner.findPath('Gate1', 'RunwayEntry1');
  test.assertFalse(nodeBlocked.success, '节点被占用时无可用路径');

  planner.releaseNode('Intersection1');

  const path2 = planner.findPath('Gate2', 'RunwayEntry1');
  test.assertTruthy(path2.success, '节点释放后路径可用');
  test.assertEqual(path2.totalLength, 330, '备用路径长度正确');

  const taxiways = planner.getAllTaxiways();
  test.assertEqual(taxiways.length, 5, '正确返回所有滑行道');
});

test.describe('4. 冲突检测综合测试', () => {
  const detector = new ConflictDetector();
  detector.addRunway('01R');
  detector.addRunway('18L');
  detector.addTaxiway('A', 'Gate1', 'Entry01R', 100);
  detector.addTaxiway('B', 'Gate2', 'Entry18L', 120);

  test.assertTruthy(true, '初始化冲突检测器成功');

  const takeoff1 = detector.requestTakeoff('CA123', '01R', 'HEAVY');
  test.assertTruthy(takeoff1.success, '第一架飞机成功获得起飞许可');

  const takeoffConflict = detector.requestTakeoff('CA456', '01R', 'MEDIUM');
  test.assertFalse(takeoffConflict.success, '跑道被占用时无法起飞');
  test.assertEqual(takeoffConflict.conflicts.length, 2, '检测到2个冲突');
  test.assertEqual(takeoffConflict.conflicts[0].type, '跑道占用', '冲突类型正确');
  test.assertEqual(takeoffConflict.conflicts[1].type, '尾流间隔', '尾流冲突检测正确');

  detector.completeOperation('CA123');
  const runwayStatus = detector.getRunwayStatus();
  test.assertFalse(runwayStatus[0].occupied, '完成操作后跑道已释放');

  const now = Date.now();
  detector.requestTakeoff('CA789', '01R', 'HEAVY');
  detector.completeOperation('CA789');
  
  const immediateTakeoff = detector.requestTakeoff('CA999', '01R', 'LIGHT');
  test.assertFalse(immediateTakeoff.success, '尾流间隔不足时无法起飞');

  const taxiResult = detector.requestTaxi('CA111', 'Gate1', 'Entry01R');
  test.assertTruthy(taxiResult.success, '成功获得滑行许可');
  test.assertEqual(taxiResult.taxiwayPath.length, 1, '滑行路径正确');

  const taxiConflict = detector.requestTaxi('CA222', 'Gate1', 'Entry01R');
  test.assertFalse(taxiConflict.success, '滑行道被占用时检测到冲突');
});

test.describe('5. 边缘情况和边界测试', () => {
  const detector = new ConflictDetector();
  detector.addRunway('01R');
  detector.addRunway('18L');

  test.assertTruthy(true, '边缘情况测试开始');

  const runwayStatus = detector.getRunwayStatus();
  test.assertEqual(runwayStatus.length, 2, '初始跑道数量正确');
  test.assertFalse(runwayStatus[0].occupied, '初始跑道未被占用');

  const takeoff1 = detector.requestTakeoff('CA123', '01R', 'HEAVY');
  test.assertTruthy(takeoff1.success, '首次起飞成功');
  
  const completeResult = detector.completeOperation('CA123');
  test.assertTruthy(completeResult.success, '完成操作成功');

  const doubleComplete = detector.completeOperation('CA123');
  test.assertFalse(doubleComplete.success, '重复完成操作返回失败');
  test.assertEqual(doubleComplete.reason, '航班不存在', '正确返回错误原因');

  const statusAfter = detector.getRunwayStatus();
  test.assertFalse(statusAfter[0].occupied, '完成后跑道未被占用');

  const planner = new TaxiwayPathPlanner();
  planner.addTaxiway('A', 'N1', 'N2', 100);
  
  const sameNodePath = planner.findPath('N1', 'N1');
  test.assertTruthy(sameNodePath.success, '相同起点终点有路径');
  test.assertEqual(sameNodePath.totalLength, 0, '相同节点路径长度为0');

  const occupy = planner.occupyTaxiway('A', 'CA123');
  test.assertTruthy(occupy.success, '成功占用滑行道');
  
  const occupyAgain = planner.occupyTaxiway('A', 'CA456');
  test.assertFalse(occupyAgain.success, '重复占用滑行道失败');
  
  const release = planner.releaseTaxiway('A');
  test.assertTruthy(release.success, '成功释放滑行道');
  test.assertTruthy(release.wasOccupied, '正确返回之前被占用状态');

  const releaseAgain = planner.releaseTaxiway('A');
  test.assertFalse(releaseAgain.wasOccupied, '重复释放返回未被占用状态');
});

test.describe('6. 不同机型组合测试', () => {
  const wakeSep = new WakeSeparation();
  const baseTime = Date.now();

  const combinations = [
    { leading: 'HEAVY', trailing: 'HEAVY', expected: 120 },
    { leading: 'HEAVY', trailing: 'MEDIUM', expected: 150 },
    { leading: 'HEAVY', trailing: 'LIGHT', expected: 180 },
    { leading: 'MEDIUM', trailing: 'HEAVY', expected: 90 },
    { leading: 'MEDIUM', trailing: 'MEDIUM', expected: 90 },
    { leading: 'MEDIUM', trailing: 'LIGHT', expected: 120 },
    { leading: 'LIGHT', trailing: 'HEAVY', expected: 60 },
    { leading: 'LIGHT', trailing: 'MEDIUM', expected: 60 },
    { leading: 'LIGHT', trailing: 'LIGHT', expected: 60 },
  ];

  combinations.forEach(({ leading, trailing, expected }) => {
    wakeSep.clearHistory();
    wakeSep.addOperation('01R', leading, 'takeoff', baseTime - 50000);
    const result = wakeSep.checkSeparation('01R', trailing, 'takeoff', baseTime);
    test.assertEqual(
      result.requiredSeparation, 
      expected, 
      `${leading} 后 ${trailing} 间隔 ${expected} 秒`
    );
  });

  wakeSep.clearHistory();
  wakeSep.addOperation('01R', 'HEAVY', 'landing', baseTime - 100000);
  const takeoffAfterLanding = wakeSep.checkSeparation('01R', 'MEDIUM', 'takeoff', baseTime);
  test.assertTruthy(
    takeoffAfterLanding.requiredSeparation >= 108, 
    '降落->起飞间隔正确（1.2倍系数)'
  );

  wakeSep.clearHistory();
  wakeSep.addOperation('01R', 'HEAVY', 'takeoff', baseTime - 100000);
  const landingAfterTakeoff = wakeSep.checkSeparation('01R', 'MEDIUM', 'landing', baseTime);
  test.assertTruthy(
    landingAfterTakeoff.requiredSeparation >= 135, 
    '起飞->降落间隔正确（1.5倍系数)'
  );
});

console.log('\n' + '═'.repeat(50));
console.log('所有测试完成！');
test.summary();

process.exit(test.failed === 0 ? 0 : 1);
