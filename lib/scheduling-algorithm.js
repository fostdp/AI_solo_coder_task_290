class RunwayLock {
  constructor() {
    this.runways = new Map();
    this.crossingRunways = new Map();
  }

  addRunway(runwayId) {
    this.runways.set(runwayId, {
      occupied: false,
      lockedBy: null,
      lockedAt: null,
      lockDuration: 0,
      currentOperation: null
    });
  }

  setCrossingRunways(runwayA, runwayB) {
    if (!this.crossingRunways.has(runwayA)) {
      this.crossingRunways.set(runwayA, new Set());
    }
    if (!this.crossingRunways.has(runwayB)) {
      this.crossingRunways.set(runwayB, new Set());
    }
    this.crossingRunways.get(runwayA).add(runwayB);
    this.crossingRunways.get(runwayB).add(runwayA);
  }

  getCrossingConflicts(runwayId) {
    const conflicts = [];
    const crossingRunways = this.crossingRunways.get(runwayId) || new Set();
    
    for (const crossRunwayId of crossingRunways) {
      const runway = this.runways.get(crossRunwayId);
      if (runway && runway.occupied) {
        conflicts.push({
          runwayId: crossRunwayId,
          lockedBy: runway.lockedBy,
          reason: '交叉跑道被占用'
        });
      }
    }
    return conflicts;
  }

  acquireLock(runwayId, planeId, operation = 'takeoff', duration = 10) {
    if (!this.runways.has(runwayId)) {
      throw new Error(`跑道 ${runwayId} 不存在`);
    }

    const runway = this.runways.get(runwayId);
    
    if (runway.occupied) {
      return { 
        success: false, 
        reason: '跑道已被占用', 
        currentPlane: runway.lockedBy,
        conflictType: 'same_runway'
      };
    }

    const crossConflicts = this.getCrossingConflicts(runwayId);
    if (crossConflicts.length > 0) {
      return {
        success: false,
        reason: '交叉跑道冲突',
        conflicts: crossConflicts,
        conflictType: 'cross_runway'
      };
    }

    runway.occupied = true;
    runway.lockedBy = planeId;
    runway.lockedAt = Date.now();
    runway.lockDuration = duration;
    runway.currentOperation = operation;

    return { 
      success: true, 
      runwayId, 
      planeId, 
      expiresAt: runway.lockedAt + duration * 1000,
      checkedCrossings: Array.from(this.crossingRunways.get(runwayId) || [])
    };
  }

  releaseLock(runwayId) {
    if (!this.runways.has(runwayId)) {
      throw new Error(`跑道 ${runwayId} 不存在`);
    }

    const runway = this.runways.get(runwayId);
    const wasLocked = runway.occupied;
    const releasedPlane = runway.lockedBy;
    
    runway.occupied = false;
    runway.lockedBy = null;
    runway.lockedAt = null;
    runway.lockDuration = 0;
    runway.currentOperation = null;

    return { success: true, wasLocked, releasedPlane };
  }

  isOccupied(runwayId) {
    if (!this.runways.has(runwayId)) {
      throw new Error(`跑道 ${runwayId} 不存在`);
    }
    return this.runways.get(runwayId).occupied;
  }

  getLockInfo(runwayId) {
    if (!this.runways.has(runwayId)) {
      throw new Error(`跑道 ${runwayId} 不存在`);
    }
    const runway = this.runways.get(runwayId);
    return {
      ...runway,
      crossingRunways: Array.from(this.crossingRunways.get(runwayId) || [])
    };
  }

  getAvailableRunways() {
    const available = [];
    this.runways.forEach((info, id) => {
      if (!info.occupied) {
        const crossConflicts = this.getCrossingConflicts(id);
        if (crossConflicts.length === 0) {
          available.push(id);
        }
      }
    });
    return available;
  }

  getAllRunways() {
    const runways = [];
    this.runways.forEach((info, id) => {
      runways.push({
        id,
        ...info,
        crossingRunways: Array.from(this.crossingRunways.get(id) || [])
      });
    });
    return runways;
  }
}

class WakeSeparation {
  constructor() {
    this.aircraftTypes = {
      HEAVY: { 
        wakeCategory: 'H', 
        takeoffSeparation: 120, 
        landingSeparation: 180,
        wakeDissipationRate: 1.5
      },
      MEDIUM: { 
        wakeCategory: 'M', 
        takeoffSeparation: 90, 
        landingSeparation: 120,
        wakeDissipationRate: 1.0
      },
      LIGHT: { 
        wakeCategory: 'L', 
        takeoffSeparation: 60, 
        landingSeparation: 90,
        wakeDissipationRate: 0.7
      }
    };

    this.wakeSeparationMatrix = {
      H: { H: 120, M: 150, L: 180 },
      M: { H: 90, M: 90, L: 120 },
      L: { H: 60, M: 60, L: 60 }
    };

    this.sameRunwaySeparation = {
      'takeoff->takeoff': 1.0,
      'takeoff->landing': 1.5,
      'landing->takeoff': 1.2,
      'landing->landing': 1.0
    };

    this.parallelRunwaySeparation = {
      'takeoff->takeoff': 0.6,
      'takeoff->landing': 0.8,
      'landing->takeoff': 0.7,
      'landing->landing': 0.8
    };

    this.operationHistory = [];
  }

  addOperation(runwayId, aircraftType, operationType, timestamp = Date.now()) {
    const normalizedType = this.aircraftTypes[aircraftType] ? aircraftType : 'MEDIUM';
    this.operationHistory.push({
      runwayId,
      aircraftType: normalizedType,
      operationType,
      timestamp,
      wakeCategory: this.aircraftTypes[normalizedType].wakeCategory
    });
  }

  checkSeparation(runwayId, aircraftType, operationType, timestamp = Date.now()) {
    const trailingCategory = this.aircraftTypes[aircraftType] ? aircraftType : 'MEDIUM';
    const trailingWakeCat = this.aircraftTypes[trailingCategory].wakeCategory;
    
    const recentOperations = this.operationHistory
      .filter(op => timestamp - op.timestamp < 300000)
      .sort((a, b) => b.timestamp - a.timestamp);

    if (recentOperations.length === 0) {
      return { 
        safe: true, 
        requiredSeparation: 0, 
        actualSeparation: Infinity,
        conflicts: []
      };
    }

    const conflicts = [];
    let maxRequiredSeparation = 0;
    let criticalOperation = null;

    for (const op of recentOperations) {
      const timeSinceOperation = (timestamp - op.timestamp) / 1000;
      
      let parallelFactor = 1.0;
      if (op.runwayId !== runwayId) {
        parallelFactor = this.parallelRunwaySeparation[`${op.operationType}->${operationType}`] || 0.8;
      }

      const operationFactor = this.sameRunwaySeparation[`${op.operationType}->${operationType}`] || 1.0;
      const baseSeparation = this.wakeSeparationMatrix[op.wakeCategory][trailingWakeCat];
      const requiredSeparation = Math.ceil(baseSeparation * operationFactor * parallelFactor);

      if (timeSinceOperation < requiredSeparation) {
        conflicts.push({
          runwayId: op.runwayId,
          aircraftType: op.aircraftType,
          operationType: op.operationType,
          requiredSeparation,
          actualSeparation: timeSinceOperation,
          isParallel: op.runwayId !== runwayId
        });
        
        if (requiredSeparation > maxRequiredSeparation) {
          maxRequiredSeparation = requiredSeparation;
          criticalOperation = op;
        }
      } else if (requiredSeparation > maxRequiredSeparation) {
        maxRequiredSeparation = requiredSeparation;
      }
    }

    const actualSinceLast = recentOperations.length > 0 
      ? (timestamp - recentOperations[0].timestamp) / 1000 
      : Infinity;

    return {
      safe: conflicts.length === 0,
      requiredSeparation: maxRequiredSeparation,
      actualSeparation: actualSinceLast,
      conflicts,
      criticalOperation,
      checkedOperations: recentOperations.length
    };
  }

  getRequiredSeparation(leadingType, trailingType, leadingOperation, trailingOperation, isParallel = false) {
    const leadingCat = this.aircraftTypes[leadingType]?.wakeCategory || 'M';
    const trailingCat = this.aircraftTypes[trailingType]?.wakeCategory || 'M';
    
    let baseSeparation = this.wakeSeparationMatrix[leadingCat][trailingCat];
    
    const operationKey = `${leadingOperation}->${trailingOperation}`;
    const factor = isParallel 
      ? (this.parallelRunwaySeparation[operationKey] || 0.8)
      : (this.sameRunwaySeparation[operationKey] || 1.0);

    return Math.ceil(baseSeparation * factor);
  }

  getWaitTime(runwayId, aircraftType, operationType, timestamp = Date.now()) {
    const result = this.checkSeparation(runwayId, aircraftType, operationType, timestamp);
    if (result.safe) return 0;
    
    const maxWait = Math.max(...result.conflicts.map(c => c.requiredSeparation - c.actualSeparation));
    return Math.ceil(maxWait);
  }

  getEarliestAvailableTime(runwayId, aircraftType, operationType) {
    const now = Date.now();
    const waitSeconds = this.getWaitTime(runwayId, aircraftType, operationType);
    return new Date(now + waitSeconds * 1000);
  }

  clearHistory() {
    this.operationHistory = [];
  }

  cleanupOldHistory(beforeTime = Date.now() - 600000) {
    this.operationHistory = this.operationHistory.filter(op => op.timestamp > beforeTime);
  }
}

class TaxiwayPathPlanner {
  constructor() {
    this.taxiways = new Map();
    this.graph = new Map();
    this.occupiedNodes = new Set();
    this.vehicleReservations = new Map();
  }

  addTaxiway(taxiwayId, startNode, endNode, length = 100, maxSpeed = 30, width = 1) {
    this.taxiways.set(taxiwayId, {
      id: taxiwayId,
      startNode,
      endNode,
      length,
      maxSpeed,
      width,
      occupied: false,
      occupiedBy: null,
      reservedBy: null
    });

    if (!this.graph.has(startNode)) {
      this.graph.set(startNode, []);
    }
    if (!this.graph.has(endNode)) {
      this.graph.set(endNode, []);
    }

    this.graph.get(startNode).push({ node: endNode, taxiwayId, length });
    this.graph.get(endNode).push({ node: startNode, taxiwayId, length });
  }

  findPath(startNode, endNode, options = {}) {
    const { 
      minWidth = 1,
      maxLength = Infinity,
      avoidNodes = [],
      avoidTaxiways = []
    } = options;

    if (!this.graph.has(startNode) || !this.graph.has(endNode)) {
      return { success: false, reason: '节点不存在' };
    }

    const distances = new Map();
    const previous = new Map();
    const pathTaxiways = new Map();
    const unvisited = new Set();

    this.graph.forEach((_, node) => {
      distances.set(node, node === startNode ? 0 : Infinity);
      unvisited.add(node);
    });

    while (unvisited.size > 0) {
      let minNode = null;
      let minDistance = Infinity;
      
      for (const node of unvisited) {
        if (distances.get(node) < minDistance) {
          minDistance = distances.get(node);
          minNode = node;
        }
      }

      if (minNode === null || minDistance === Infinity) break;
      if (minNode === endNode) break;
      if (minDistance > maxLength) break;

      unvisited.delete(minNode);

      const neighbors = this.graph.get(minNode) || [];
      for (const neighbor of neighbors) {
        if (!unvisited.has(neighbor.node)) continue;
        if (this.occupiedNodes.has(neighbor.node)) continue;
        if (avoidNodes.includes(neighbor.node)) continue;
        if (avoidTaxiways.includes(neighbor.taxiwayId)) continue;

        const taxiway = this.taxiways.get(neighbor.taxiwayId);
        if (taxiway.occupied || taxiway.reservedBy) continue;
        if (taxiway.width < minWidth) continue;

        const alt = distances.get(minNode) + neighbor.length;
        if (alt < distances.get(neighbor.node)) {
          distances.set(neighbor.node, alt);
          previous.set(neighbor.node, minNode);
          pathTaxiways.set(neighbor.node, neighbor.taxiwayId);
        }
      }
    }

    if (distances.get(endNode) === Infinity) {
      return { success: false, reason: '没有可用路径' };
    }

    const path = [];
    const taxiwayPath = [];
    let current = endNode;

    while (current !== startNode) {
      path.unshift(current);
      if (pathTaxiways.has(current)) {
        taxiwayPath.unshift(pathTaxiways.get(current));
      }
      current = previous.get(current);
      if (!current) break;
    }
    path.unshift(startNode);

    const totalLength = distances.get(endNode);
    const estimatedTime = Math.ceil(totalLength / 10);

    return {
      success: true,
      path,
      taxiwayPath,
      totalLength,
      estimatedTime,
      nodeCount: path.length,
      edgeCount: taxiwayPath.length
    };
  }

  reservePath(taxiwayPath, vehicleId, duration = 30) {
    const reservations = [];
    const expireAt = Date.now() + duration * 1000;

    for (const taxiwayId of taxiwayPath) {
      const result = this.reserveTaxiway(taxiwayId, vehicleId, expireAt);
      if (!result.success) {
        for (const reserved of reservations) {
          this.releaseReservation(reserved);
        }
        return { success: false, conflict: taxiwayId, details: result };
      }
      reservations.push(taxiwayId);
    }

    return { success: true, reservedTaxiways: reservations, expireAt };
  }

  reserveTaxiway(taxiwayId, vehicleId, expireAt) {
    if (!this.taxiways.has(taxiwayId)) {
      throw new Error(`滑行道 ${taxiwayId} 不存在`);
    }

    const taxiway = this.taxiways.get(taxiwayId);
    if (taxiway.occupied || taxiway.reservedBy) {
      return { success: false, reason: '滑行道已被占用或预留', current: taxiway.occupiedBy || taxiway.reservedBy };
    }

    taxiway.reservedBy = vehicleId;
    taxiway.reservedUntil = expireAt;
    return { success: true };
  }

  releaseReservation(taxiwayId) {
    if (!this.taxiways.has(taxiwayId)) {
      throw new Error(`滑行道 ${taxiwayId} 不存在`);
    }
    const taxiway = this.taxiways.get(taxiwayId);
    taxiway.reservedBy = null;
    taxiway.reservedUntil = null;
    return { success: true };
  }

  occupyTaxiway(taxiwayId, planeId) {
    if (!this.taxiways.has(taxiwayId)) {
      throw new Error(`滑行道 ${taxiwayId} 不存在`);
    }

    const taxiway = this.taxiways.get(taxiwayId);
    if (taxiway.occupied) {
      return { success: false, reason: '滑行道已被占用', currentPlane: taxiway.occupiedBy };
    }

    taxiway.occupied = true;
    taxiway.occupiedBy = planeId;
    taxiway.reservedBy = null;
    taxiway.reservedUntil = null;
    return { success: true, taxiwayId, planeId };
  }

  releaseTaxiway(taxiwayId) {
    if (!this.taxiways.has(taxiwayId)) {
      throw new Error(`滑行道 ${taxiwayId} 不存在`);
    }

    const taxiway = this.taxiways.get(taxiwayId);
    const wasOccupied = taxiway.occupied;
    const releasedPlane = taxiway.occupiedBy;

    taxiway.occupied = false;
    taxiway.occupiedBy = null;

    return { success: true, wasOccupied, releasedPlane };
  }

  occupyNode(nodeId, planeId) {
    if (this.occupiedNodes.has(nodeId)) {
      return { success: false, reason: '节点已被占用' };
    }
    this.occupiedNodes.add(nodeId);
    return { success: true, nodeId, planeId };
  }

  releaseNode(nodeId) {
    this.occupiedNodes.delete(nodeId);
    return { success: true };
  }

  getTaxiwayStatus(taxiwayId) {
    if (!this.taxiways.has(taxiwayId)) {
      throw new Error(`滑行道 ${taxiwayId} 不存在`);
    }
    return { ...this.taxiways.get(taxiwayId) };
  }

  getAllTaxiways() {
    const result = [];
    this.taxiways.forEach((info, id) => {
      result.push({ id, ...info });
    });
    return result;
  }

  cleanupExpiredReservations(now = Date.now()) {
    this.taxiways.forEach(taxiway => {
      if (taxiway.reservedUntil && taxiway.reservedUntil < now) {
        taxiway.reservedBy = null;
        taxiway.reservedUntil = null;
      }
    });
  }
}

class ConflictDetector {
  constructor() {
    this.runwayLock = new RunwayLock();
    this.wakeSeparation = new WakeSeparation();
    this.pathPlanner = new TaxiwayPathPlanner();
    this.activeFlights = new Map();
    this.groundVehicles = new Map();
  }

  addRunway(runwayId) {
    this.runwayLock.addRunway(runwayId);
  }

  setCrossingRunways(runwayA, runwayB) {
    this.runwayLock.setCrossingRunways(runwayA, runwayB);
  }

  addTaxiway(taxiwayId, startNode, endNode, length = 100, maxSpeed = 30) {
    this.pathPlanner.addTaxiway(taxiwayId, startNode, endNode, length, maxSpeed);
  }

  requestTakeoff(flightId, runwayId, aircraftType = 'MEDIUM') {
    const conflicts = [];

    const lockResult = this.runwayLock.acquireLock(runwayId, flightId, 'takeoff');
    if (!lockResult.success) {
      conflicts.push({ type: lockResult.conflictType === 'cross_runway' ? '交叉跑道冲突' : '跑道占用', ...lockResult });
    }

    const wakeResult = this.wakeSeparation.checkSeparation(runwayId, aircraftType, 'takeoff');
    if (!wakeResult.safe) {
      conflicts.push({ type: '尾流间隔', ...wakeResult });
    }

    if (conflicts.length > 0) {
      if (lockResult.success) {
        this.runwayLock.releaseLock(runwayId);
      }
      return { success: false, conflicts };
    }

    this.wakeSeparation.addOperation(runwayId, aircraftType, 'takeoff');
    this.activeFlights.set(flightId, {
      id: flightId,
      runwayId,
      aircraftType,
      operation: 'takeoff',
      startTime: Date.now(),
      status: 'processing'
    });

    return { success: true, flightId, runwayId, wakeChecked: wakeResult.checkedOperations };
  }

  requestLanding(flightId, runwayId, aircraftType = 'MEDIUM') {
    const conflicts = [];

    const lockResult = this.runwayLock.acquireLock(runwayId, flightId, 'landing');
    if (!lockResult.success) {
      conflicts.push({ type: lockResult.conflictType === 'cross_runway' ? '交叉跑道冲突' : '跑道占用', ...lockResult });
    }

    const wakeResult = this.wakeSeparation.checkSeparation(runwayId, aircraftType, 'landing');
    if (!wakeResult.safe) {
      conflicts.push({ type: '尾流间隔', ...wakeResult });
    }

    if (conflicts.length > 0) {
      if (lockResult.success) {
        this.runwayLock.releaseLock(runwayId);
      }
      return { success: false, conflicts };
    }

    this.wakeSeparation.addOperation(runwayId, aircraftType, 'landing');
    this.activeFlights.set(flightId, {
      id: flightId,
      runwayId,
      aircraftType,
      operation: 'landing',
      startTime: Date.now(),
      status: 'processing'
    });

    return { success: true, flightId, runwayId, wakeChecked: wakeResult.checkedOperations };
  }

  requestTaxi(flightId, startNode, endNode, options = {}) {
    const pathResult = this.pathPlanner.findPath(startNode, endNode, options);
    
    if (!pathResult.success) {
      return { success: false, conflict: pathResult.reason };
    }

    const reserveResult = this.pathPlanner.reservePath(pathResult.taxiwayPath, flightId);
    if (!reserveResult.success) {
      return { success: false, conflict: '滑行道预留冲突', details: reserveResult };
    }

    for (const taxiwayId of pathResult.taxiwayPath) {
      const occupyResult = this.pathPlanner.occupyTaxiway(taxiwayId, flightId);
      if (!occupyResult.success) {
        for (const twId of pathResult.taxiwayPath) {
          this.pathPlanner.releaseTaxiway(twId);
          this.pathPlanner.releaseReservation(twId);
        }
        return { success: false, conflict: '滑行道占用冲突', details: occupyResult };
      }
    }

    return { success: true, ...pathResult, ...reserveResult };
  }

  completeOperation(flightId) {
    const flight = this.activeFlights.get(flightId);
    if (!flight) {
      return { success: false, reason: '航班不存在' };
    }

    if (flight.runwayId) {
      this.runwayLock.releaseLock(flight.runwayId);
    }

    this.activeFlights.delete(flightId);
    return { success: true, flightId, duration: Date.now() - flight.startTime };
  }

  getRunwayStatus() {
    return this.runwayLock.getAllRunways();
  }

  getTaxiwayStatus() {
    return this.pathPlanner.getAllTaxiways();
  }

  findBestRunway(aircraftType, operationType) {
    const now = Date.now();
    const runways = this.runwayLock.getAllRunways();
    
    const scoredRunways = runways.map(runway => {
      const wakeInfo = this.wakeSeparation.checkSeparation(runway.id, aircraftType, operationType, now);
      const crossConflicts = this.runwayLock.getCrossingConflicts(runway.id);
      
      return {
        runwayId: runway.id,
        isAvailable: !runway.occupied && crossConflicts.length === 0,
        waitTime: wakeInfo.safe ? 0 : this.wakeSeparation.getWaitTime(runway.id, aircraftType, operationType),
        crossConflicts: crossConflicts.length,
        occupied: runway.occupied,
        conflicts: wakeInfo.conflicts
      };
    });

    scoredRunways.sort((a, b) => {
      if (a.isAvailable !== b.isAvailable) return a.isAvailable ? -1 : 1;
      return a.waitTime - b.waitTime;
    });

    return scoredRunways;
  }

  cleanup() {
    this.pathPlanner.cleanupExpiredReservations();
    this.wakeSeparation.cleanupOldHistory();
  }
}

class SyncManager {
  constructor() {
    this.commandQueue = [];
    this.pendingAcks = new Map();
    this.stateVersion = 0;
    this.lastSyncTime = 0;
    this.syncInterval = null;
    this.batchThreshold = 10;
    this.syncDelayMs = 50;
  }

  queueCommand(command, data, callback = null) {
    const commandId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const queuedCommand = {
      id: commandId,
      command,
      data,
      timestamp: Date.now(),
      callback
    };
    
    this.commandQueue.push(queuedCommand);
    
    if (callback) {
      this.pendingAcks.set(commandId, { callback, timeout: Date.now() + 5000 });
    }
    
    if (this.commandQueue.length >= this.batchThreshold) {
      return this.processBatch();
    }
    
    if (!this.syncInterval) {
      this.scheduleSync();
    }
    
    return { queued: true, commandId, queueSize: this.commandQueue.length };
  }

  scheduleSync() {
    if (this.syncInterval) {
      clearTimeout(this.syncInterval);
    }
    this.syncInterval = setTimeout(() => {
      this.processBatch();
      this.syncInterval = null;
    }, this.syncDelayMs);
  }

  processBatch() {
    if (this.commandQueue.length === 0) {
      return { processed: 0, commands: [] };
    }

    const batch = [...this.commandQueue];
    this.commandQueue = [];
    this.stateVersion++;
    this.lastSyncTime = Date.now();

    return {
      processed: batch.length,
      commands: batch,
      version: this.stateVersion,
      timestamp: this.lastSyncTime
    };
  }

  getPendingCommands() {
    return [...this.commandQueue];
  }

  getSyncState() {
    return {
      version: this.stateVersion,
      lastSync: this.lastSyncTime,
      pendingCommands: this.commandQueue.length,
      pendingAcks: this.pendingAcks.size
    };
  }

  acknowledgeCommand(commandId, success, result = {}) {
    const pending = this.pendingAcks.get(commandId);
    if (pending) {
      if (pending.callback) {
        pending.callback({ success, commandId, ...result });
      }
      this.pendingAcks.delete(commandId);
      return true;
    }
    return false;
  }

  cleanupTimeouts(now = Date.now()) {
    const timedOut = [];
    this.pendingAcks.forEach((pending, commandId) => {
      if (pending.timeout < now) {
        timedOut.push(commandId);
        if (pending.callback) {
          pending.callback({ success: false, commandId, error: 'timeout' });
        }
      }
    });
    timedOut.forEach(id => this.pendingAcks.delete(id));
    return timedOut.length;
  }

  reset() {
    this.commandQueue = [];
    this.pendingAcks.clear();
    this.stateVersion = 0;
    this.lastSyncTime = 0;
    if (this.syncInterval) {
      clearTimeout(this.syncInterval);
      this.syncInterval = null;
    }
  }
}

module.exports = {
  RunwayLock,
  WakeSeparation,
  TaxiwayPathPlanner,
  ConflictDetector,
  SyncManager
};
