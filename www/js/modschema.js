// 单位 ini 的字段表：[键, 中文名, 类型, 说明]。类型：n 数字，b 布尔，s 文字，e:a|b|c 选项
const f = (key, label, type = 's', help = '') => ({ key, label, type, help });
export const SCHEMA = {
  core: [
    f('name', '单位代号', 's', '游戏内部使用的名字，必须唯一，不要有空格'),
    f('class', '类', 's', '一般用 CustomUnitMetadata'),
    f('price', '造价', 'n', '资金'), f('mass', '质量', 'n', '影响碰撞推挤'),
    f('techLevel', '科技等级', 'n'), f('buildSpeed', '建造时间(秒)', 'n'),
    f('radius', '半径', 'n', '碰撞/选择半径'), f('maxHp', '生命', 'n'),
    f('selfRegenRate', '自动回血/秒', 'n'), f('maxShield', '护盾', 'n'), f('shieldRegen', '护盾回复', 'n'),
    f('armour', '护甲', 'n'), f('energyMax', '能量上限', 'n'), f('energyRegen', '能量回复', 'n'),
    f('isBio', '生物', 'b'), f('isBug', '虫族', 'b'), f('isBuilder', '可建造', 'b'), f('isBuilding', '建筑', 'b'),
    f('footprint', '占地', 's', '例如 0,0,1,1'), f('fogOfWarSightRange', '视野', 'n'),
    f('displayText', '显示名称', 's'), f('displayDescription', '描述', 's'), f('tags', '标签', 's'), f('copyFrom', '继承自', 's'),
    f('nanoRange', '建造范围', 'n'),
  ],
  graphics: [
    f('image', '图片', 's', '例如 ROOT:\\sprites\\tank.png'), f('image_wreak', '残骸图', 's'), f('image_shadow', '阴影图', 's'),
    f('total_frames', '总帧数', 'n'), f('frame_width', '帧宽', 'n'), f('frame_height', '帧高', 'n'),
    f('scaleImagesTo', '缩放到', 'n'), f('imageScale', '图片比例', 'n'),
    f('image_turret', '炮塔图', 's'), f('teamColorsOnTurret', '炮塔着队色', 'b'),
    f('dustEffect', '扬尘', 'b'), f('splastEffect', '水花', 'b'),
  ],
  movement: [
    f('movementType', '移动类型', 'e:NONE|LAND|WATER|AIR|HOVER|OVER_CLIFF|OVER_CLIFF_WATER'),
    f('moveSpeed', '速度', 'n'), f('moveAccelerationSpeed', '加速度', 'n'), f('moveDecelerationSpeed', '减速度', 'n'),
    f('maxTurnSpeed', '最大转向速度', 'n'), f('turnAcceleration', '转向加速度', 'n'),
    f('reverseSpeedPercentage', '倒车速度比', 'n'), f('targetHeight', '高度', 'n'),
  ],
  attack: [
    f('maxAttackRange', '最大射程', 'n'), f('canAttack', '能攻击', 'b'),
    f('canAttackFlyingUnits', '打空中', 'b'), f('canAttackLandUnits', '打地面', 'b'), f('canAttackUnderwaterUnits', '打水下', 'b'),
    f('isMelee', '近战', 'b'), f('turretRotateWithBody', '炮塔随车身', 'b'), f('attackMovement', '攻击移动', 's'),
  ],
  turret: [
    f('projectile', '弹道', 's', '对应 [projectile_X] 的 X'), f('barrelX', '炮口 X', 'n'), f('barrelY', '炮口 Y', 'n'),
    f('size', '大小', 'n'), f('turnSpeed', '转速', 'n'), f('idleDir', '待机方向', 'n'), f('attachedTo', '挂在', 's'),
    f('delay', '间隔(帧)', 'n'), f('warmup', '预热', 'n'),
    f('limitingRange', '限制射程', 'n'), f('limitingMinRange', '最小射程', 'n'), f('limitingAngle', '限制角度', 'n'),
    f('shoot_sound', '射击音效', 's'), f('shoot_flame', '炮口火焰', 's'),
    f('recoilOffset', '后坐力', 'n'), f('energyUsage', '耗能', 'n'), f('resourceUsage', '耗资源', 's'), f('canShoot', '能开火', 'b'),
  ],
  projectile: [
    f('life', '寿命(帧)', 'n'), f('directDamage', '直接伤害', 'n'), f('areaDamage', '范围伤害', 'n'), f('areaRadius', '范围半径', 'n'),
    f('speed', '速度', 'n'), f('targetSpeed', '目标速度', 'n'), f('ballistic', '抛物线', 'b'), f('instant', '瞬发', 'b'),
    f('buildingDamageMultiplier', '对建筑倍率', 'n'), f('friendlyFire', '误伤友军', 'b'),
    f('image', '图片', 's'), f('drawType', '绘制方式', 's'), f('trailEffect', '拖尾', 's'),
  ],
  ai: [f('useAsBuilder', '当建造者', 'b'), f('buildPriority', '建造优先级', 'n'), f('maxGlobal', '全局上限', 'n'), f('maxEachBase', '每基地上限', 'n')],
  canBuild: [f('name', '可建造单位', 's'), f('pos', '位置', 's'), f('tech', '科技', 's'), f('forceNano', '强制纳米', 'b'), f('isLocked', '锁定', 'b'), f('price', '价格', 'n')],
  action: [f('text', '按钮文字', 's'), f('description', '说明', 's'), f('displayType', '显示类型', 's'), f('price', '价格', 'n'), f('buildSpeed', '时间', 'n'), f('convertTo', '转换为', 's'), f('spawnUnits', '生成单位', 's')],
  effect: [], resource: [], animation: [], attachment: [], leg: [], arm: [], decal: [], placementRule: [], comment: [], template: [], global_resource: [], global: [],
};

// ---- 以下按官方《Rusted Warfare Modding Reference》1.13.3 补全（键名按文档，类型保守：拿不准的一律当文字，避免下拉框吞掉表达式）----
const EXT_KEYS = {
  core: 'altNames strictLevel displayRadius showInEditor showOnMinimap displayLocaleKey borrowResourcesWhileAlive generation_resources generation_active generation_credits generation_delay startShieldAtZero shieldRenderRadius shieldDisplayOnlyDeflection shieldDeflectionDisplayRate armourMinDamageToKeep energyStartingPercentage energyNeedsToRechargeToFull dieOnZeroEnergy experimental isUnselectable isPickableStartingUnit startFallingWhenStartingUnit constructionFootprint displayFootprint buildingSelectionOffset buildingToFootprintOffsetX buildingToFootprintOffsetY placeOnlyOnResPool selfBuildRate softCollisionOnAll disableAllUnitCollisions isUnrepairableUnit canNotBeDirectlyAttacked canNotBeDamaged canNotBeGivenOrdersByPlayer canOnlyBeAttackedByUnitsWithTags stayNeutral createNeutral createOnAggressiveTeam onNewMapSpawn globalScale isLockedIfGameModeNoNuke dont_load overrideAndReplace soundOnAttackOrder soundOnMoveOrder soundOnNewSelection transportSlotsNeeded maxTransportingUnits transportUnitsRequireTag transportUnitsRequireMovementType transportUnitsBlockAirAndWaterUnits transportUnitsKeepBuiltUnits transportUnitsCanUnloadUnits transportUnitsAddUnloadOption transportUnitsUnloadDelayBetweenEachUnit transportUnitsKillOnDeath transportUnitsHealBy transportUnitsBlockOtherTransports whileNeutralTransportAnyTeam whileNeutralConvertToTransportedTeam convertToNeutralIfNotTransporting transportUnitsOnTeamChangeKeepCurrentTeam resourceRate similarResourcesHaveTag resourceMaxConcurrentReclaimingThis reclaimPrice canReclaimResources canReclaimResourcesNextSearchRange canReclaimResourcesOnlyWithTags canRepairBuildings canRepairUnits autoRepair nanoRepairSpeed nanoBuildSpeed nanoFactorySpeed nanoRangeForRepair nanoRangeForReclaim nanoRangeForRepairIsMelee nanoRangeForReclaimIsMelee extraBuildRangeWhenBuildingThis exit_x exit_y exit_dirOffset exit_heightOffset exit_moveAwayAmount dieOnConstruct numBitsOnDeath nukeOnDeath nukeOnDeathRange nukeOnDeathDamage nukeOnDeathDisableWhenNoNuke fireTurretXAtSelfOnDeath explodeOnDeath explodeOnDeathGroundCollision effectOnDeath effectOnDeathGroundCollision unitsSpawnedOnDeath unitsSpawnedOnDeath_setToTeamOfLastAttacker soundOnDeath hideScorchMark autoTriggerCooldownTime',
  graphics: 'image_back image_offsetX image_offsetY image_shadow_frames scaleTurretImagesTo imageSmoothing teamColorsUseHue drawLayer icon_zoomed_out icon_zoomed_out_neverShow isVisible whenBeingBuiltMakeTransparentTill splastEffectReverse dustEffectReverse movementEffect movementEffectReverse movementEffectRate movementEffectReverseFlipEffects repairEffect repairEffectAtTarget repairEffectRate reclaimEffect reclaimEffectAtTarget reclaimEffectRate rotate_with_direction animation_direction_units animation_direction_strideX animation_direction_strideY animation_direction_starting lock_body_rotation_with_main_turret lock_leg_rotation_with_main_turret lock_shadow_rotation_with_main_turret disableLowHpFire disableLowHpSmoke showTransportBar showHealthBar showEnergyBar',
  attack: 'canAttackNotTouchingWaterUnits canOnlyAttackUnitsWithTags canOnlyAttackUnitsWithoutTags turretMultiTargeting meleeEngangementDistance dieOnAttack isFixedFiring aimOffsetSpread stopTargetingAfterFiring disablePassiveTargeting showRangeUIGuide',
  turret: 'copyFrom barrelHeight x y turnSpeedAcceleration turnSpeedDeceleration idleDirReversing shouldResetTurret slave isMainNanoTurret shootDelay linkDelayWithTurret warmupCallDownRate warmupNoReset warmupShootDelayTransfer onShoot_freezeBodyMovementFor canAttackCondition canAttackFlyingUnits canAttackLandUnits canAttackUnderwaterUnits canAttackNotTouchingWaterUnits canOnlyAttackUnitsWithTags canOnlyAttackUnitsWithoutTags clearTurretTargetAfterFiring interceptProjectiles_withTags interceptProjectiles_andTargetingGroundUnderDistance interceptProjectiles_andUnderDistance interceptProjectiles_andOverHeight laserDefenceEnergyUse invisible image image_applyTeamColors image_drawOffsetX image_drawOffsetY chargeEffectImage warmupStartEffect shoot_sound_vol shoot_light idleSpin onShoot_playAnimation recoilOutTime recoilReturnTime',
  projectile: 'deflectionPower explodeOnEndOfLife autoTargetingOnDeadTarget unloadUpToXUnitsFromSource teleportSource spawnUnit convertHitToSourceTeam tags flameWeapon areaRadiusFromEdge areaDamageNoFalloff areaExpandTime areaHitAirAndLandAtSameTime areaHitUnderwaterAlways areaIgnoreUnitsCloserThan shieldDamageMultiplier shieldDefectionMultiplier armourIgnoreAmount targetGround targetSpeedAcceleration ballistic_delaymove_height ballistic_height targetGroundSpread speedSpread instantReuseLast disableLeadTargeting leadTargetingSpeedCalculation initialUnguidedSpeedHeight gravity color invisible drawSize frame hitSound explodeEffect explodeEffectOnShield teamColorRatio drawUnderUnits effectOnCreate shouldRevealFog alwaysVisibleInFog nukeWeapon trailEffectRate lightSize lightColor largeHitEffect lightingEffect laserEffect',
  movement: 'slowDeathFall landOnGround targetHeightDrift startingHeightOffset moveSlidingMode moveIgnoringBody moveSlidingDir joinsGroupFormations',
  ai: 'useAsTransport useAsHarvester disableUse ai_upgradePriority noneInBaseExtraPriority noneGlobalExtraPriority recommendedInEachBaseNum recommendedInEachBasePriorityIfUnmet upgradedFrom whenUsingAsHarvester_recommendedInEachBase whenUsingAsHarvester_recommendedGlobal whenUsingAsHarvester_includeOtherHarvesterCounts onlyUseAsHarvester_ifBaseHasUnitTagged',
  canBuild: 'isVisible isLockedMessage isLockedAlt isLockedAltMessage isLockedAlt2 isLockedAlt2Message addResources isGuiBlinking',
  action: 'text_zh displayRemainingStockpile iconImage unitShownInUI isActive isVisible isLocked isLockedMessage isLockedAlt isLockedAltMessage isLockedAlt2 isLockedAlt2Message allowMultipleInQueue onlyOneUnitAtATime isGuiBlinking ai_isDisabled ai_isHighPriority ai_considerSameAsBuilding autoTriggerOnEvent autoTrigger highPriorityQueue canPlayerCancel whenBuilding_cannotMove whenBuilding_playAnimation whenBuilding_rotateTo whenBuilding_rotateTo_orBackwards whenBuilding_rotateTo_waitTillRotated whenBuilding_temporarilyConvertTo whenBuilding_triggerAction spawnEffectsOnQueue playSoundToPlayerOnQueue requireConditional addEnergy addResources addResourcesScaledByAIHandicaps deleteSelf resetCustomTimer setBodyRotation alsoTriggerAction alsoQueueAction alsoTriggerOrQueueActionConditional playSoundAtUnit playSoundGlobally playSoundToPlayer fireTurretXAtGround fireTurretXAtGround_withOffset fireTurretXAtGround_withProjectile fireTurretXAtGround_count fireTurretXAtGround_onlyOverPassableTileOf spawnEffects produceUnits addUnitsIntoTransport deleteNumUnitsFromTransport deleteNumUnitsFromTransport_onlyWithTags startUnloadingTransport forceUnloadTransportNow clearAllWaypoints clearActiveWaypoint addWaypoint_type addWaypoint_unitType addWaypoint_prepend addWaypoint_triggerActionIfFailed addWaypoint_maxTime addWaypoint_target_nearestUnit_tagged addWaypoint_target_nearestUnit_team addWaypoint_target_nearestUnit_maxRange addWaypoint_target_mapMustBeReachable addWaypoint_position_offsetFromSelf addWaypoint_position_fromAction addWaypoint_position_randomOffsetFromSelf playAnimation playAnimationIfNotPlaying finishPlayingLastAnimation stopLastAnimation switchToNeutralTeam switchToAggressiveTeam takeResources takeResources_include takeResources_exclude takeResources_trigger takeResources_discard takeResources_keepResourcesOnTarget takeResources_maxUnits convertResource_from convertResource_to convertResource_minAmount convertResource_maxAmount convertResource_multiplyAmountBy resourceAmount resourceAmount_setValue resourceAmount_addOtherResource resourceAmount_multiplyBy attachments_addNewUnits attachments_deleteNumUnits attachments_onlyOnSlots disconnectFromParent temporarilyAddTags temporarilyRemoveTags resetToDefaultTags addGlobalTeamTags removeGlobalTeamTags showMessageToPlayer showMessageToAllPlayers showQuickWarLogToPlayer showQuickWarLogToAllPlayers debugMessage',
  leg: 'x y copyFrom attach_x attach_y rotateSpeed endDirOffset lockMovement heightSpeed moveSpeed moveWarmUp holdDisMin holdDisMax holdDisMin_maxMovingLegs hold_moveOnlyIfFurthest holdDisMin_checkNeighbours hardLimit estimatingPositionMultiplier hidden image_end image_end_shadow image_end_teamColors image_foot image_foot_shadow image_middle image_leg drawOverBody drawUnderAllUnits drawDirOffset dust_effect spinRate favourOppositeSideNeighbours drawLegWhenZoomedOut drawFootWhenZoomedOut draw_foot_on_top resetAngle',
  arm: 'x y copyFrom attach_x attach_y rotateSpeed endDirOffset lockMovement heightSpeed moveSpeed moveWarmUp holdDisMin holdDisMax hardLimit hidden image_end image_end_shadow image_end_teamColors image_foot image_foot_shadow image_middle image_leg drawOverBody drawUnderAllUnits drawDirOffset dust_effect spinRate resetAngle',
  attachment: 'x y height idleDir isVisible onCreateSpawnUnitOf canBeAttackedAndDamaged isUnselectable lockLegMovement keepAliveWhenParentDies setDrawLayerOnTop setDrawLayerOnBottom addTransportedUnits lockRotation rotateWithParent resetRotationWhenNotAttacking deattachIfWantingToMove prioritizeParentsMainTarget alwaysAllowedToAttackParentsMainTargetWill canAttack onParentTeamChangeKeepCurrentTeam',
  effect: 'life alsoEmitEffects ifSpawnFailsEmitEffects alsoPlaySound createWhenOffscreen createWhenZoomedOut createWhenOverLiquid createWhenOverLand spawnChance showInFog delayedStartTimer liveAfterAttachedDies priority attachedToUnit alwayStartDirAtZero atmospheric physics physicsGravity xOffsetRelative yOffsetRelative xOffsetRelativeRandom yOffsetRelativeRandom xOffsetAbsolute yOffsetAbsolute xOffsetAbsoluteRandom yOffsetAbsoluteRandom xSpeedRelative ySpeedRelative xSpeedRelativeRandom ySpeedRelativeRandom xSpeedAbsolute ySpeedAbsolute xSpeedAbsoluteRandom ySpeedAbsoluteRandom hOffset hOffsetRandom hSpeed hSpeedRandom dirOffset dirOffsetRandom dirSpeed dirSpeedRandom frameIndex frameIndexRandom stripIndex image imageShadow scaleTo scaleFrom color teamColorRatio fadeInTime fadeOut alpha shadow total_frames animateFrameStart animateFrameEnd animateFramePingPong animateFrameSpeed animateFrameSpeedRandom',
  animation: 'onActions onActionsQueuedUnitPlayAt blendIn blendOut pingPong KeyframeTimeScale direction_units direction_strideX direction_strideY direction_starting',
  global_resource: 'displayName displayNameShort hidden priority displayColor color equivalentGlobalResourceForAI',
  resource: 'displayName displayNameShort hidden priority displayColor color equivalentGlobalResourceForAI',
};
// 中文名（没写的就显示键名本身）
const EXT_LABEL = {
  shootDelay: '射击间隔(帧)', barrelHeight: '炮口高度', canAttackCondition: '攻击条件', warmupCallDownRate: '预热回落速度', deflectionPower: '偏转力',
  spawnUnit: '命中生成单位', armourIgnoreAmount: '无视护甲', areaDamageNoFalloff: '范围伤害不衰减', shieldDamageMultiplier: '对护盾倍率',
  gravity: '重力', color: '颜色', explodeEffect: '爆炸特效', hitSound: '命中音效', altNames: '别名', showInEditor: '编辑器可见', experimental: '实验单位',
  nanoRepairSpeed: '修理速度', nanoBuildSpeed: '建造速度', nanoFactorySpeed: '工厂速度', canRepairUnits: '能修单位', canRepairBuildings: '能修建筑',
  canReclaimResources: '能采集资源', nukeOnDeath: '死亡核爆', explodeOnDeath: '死亡爆炸', effectOnDeath: '死亡特效', unitsSpawnedOnDeath: '死亡生成单位',
  maxTransportingUnits: '载运数量', transportSlotsNeeded: '占载运格', isUnselectable: '不可选中', stayNeutral: '保持中立', createNeutral: '生成为中立',
  canNotBeDamaged: '不会受伤', canNotBeDirectlyAttacked: '不可被直接攻击', autoRepair: '自动修理', shieldDisplayOnlyDeflection: '护盾只显示偏转',
  recommendedInEachBaseNum: 'AI 每基地建议数', maxGlobal: '全局上限', buildPriority: '建造优先级', disableUse: 'AI 不使用', upgradedFrom: '升级自',
  autoTrigger: '自动触发条件', autoTriggerOnEvent: '事件触发', requireConditional: '执行条件', alsoTriggerAction: '同时触发动作', alsoQueueAction: '同时排队动作',
  isActive: '是否可用', isVisible: '是否可见', isLocked: '是否锁定', isLockedMessage: '锁定提示', addResources: '增加资源', resourceAmount: '资源数量',
  takeResources: '拿走资源', temporarilyAddTags: '临时加标签', temporarilyRemoveTags: '临时去标签', addGlobalTeamTags: '加全队标签', removeGlobalTeamTags: '去全队标签',
  showMessageToPlayer: '给玩家提示', showMessageToAllPlayers: '给所有人提示', debugMessage: '调试信息', switchToNeutralTeam: '变中立', switchToAggressiveTeam: '变敌对中立',
  fireTurretXAtGround: '向地面开火', produceUnits: '直接产出单位', playAnimation: '播放动画', clearAllWaypoints: '清空路线', deleteSelf: '自毁',
  addEnergy: '加能量', convertTo: '转换为', spawnEffects: '生成特效', life: '寿命', alpha: '透明度', scaleTo: '缩放到', scaleFrom: '缩放自',
  fadeOut: '淡出', frameIndex: '帧序号', image: '图片', priority: '优先级', hidden: '隐藏', displayName: '显示名', displayNameShort: '短名',
  displayColor: '显示颜色', moveSlidingMode: '滑行模式', landOnGround: '落地', startingHeightOffset: '起始高度偏移', joinsGroupFormations: '参与编队',
  isMelee: '近战', turretMultiTargeting: '炮塔多目标', disablePassiveTargeting: '关闭被动索敌', isFixedFiring: '固定射击',
  invisible: '不可见', recoilOutTime: '后坐出', recoilReturnTime: '后坐回', idleSpin: '待机旋转', slave: '从属', attachedTo: '挂在',
};
// 只有这些确定是布尔值才给下拉框；其余的一律文字，避免把表达式吞掉
const EXT_BOOL = new Set('showInEditor showOnMinimap startShieldAtZero shieldDisplayOnlyDeflection dieOnZeroEnergy experimental isUnselectable isPickableStartingUnit startFallingWhenStartingUnit softCollisionOnAll disableAllUnitCollisions isUnrepairableUnit canNotBeDirectlyAttacked canNotBeDamaged canNotBeGivenOrdersByPlayer stayNeutral createNeutral createOnAggressiveTeam isLockedIfGameModeNoNuke dont_load overrideAndReplace transportUnitsBlockAirAndWaterUnits transportUnitsKeepBuiltUnits transportUnitsCanUnloadUnits transportUnitsAddUnloadOption transportUnitsKillOnDeath transportUnitsBlockOtherTransports whileNeutralTransportAnyTeam whileNeutralConvertToTransportedTeam convertToNeutralIfNotTransporting transportUnitsOnTeamChangeKeepCurrentTeam canReclaimResources canRepairBuildings canRepairUnits autoRepair nanoRangeForRepairIsMelee nanoRangeForReclaimIsMelee dieOnConstruct nukeOnDeath nukeOnDeathDisableWhenNoNuke explodeOnDeath explodeOnDeathGroundCollision unitsSpawnedOnDeath_setToTeamOfLastAttacker hideScorchMark imageSmoothing teamColorsUseHue isVisible movementEffectReverseFlipEffects rotate_with_direction lock_body_rotation_with_main_turret lock_leg_rotation_with_main_turret lock_shadow_rotation_with_main_turret disableLowHpFire disableLowHpSmoke showTransportBar showHealthBar showEnergyBar canAttackNotTouchingWaterUnits turretMultiTargeting isMelee dieOnAttack isFixedFiring stopTargetingAfterFiring disablePassiveTargeting showRangeUIGuide idleDirReversing shouldResetTurret slave isMainNanoTurret warmupNoReset clearTurretTargetAfterFiring invisible image_applyTeamColors idleSpin explodeOnEndOfLife autoTargetingOnDeadTarget convertHitToSourceTeam areaDamageNoFalloff areaHitAirAndLandAtSameTime areaHitUnderwaterAlways targetGround disableLeadTargeting alwaysVisibleInFog drawUnderUnits shouldRevealFog nukeWeapon landOnGround moveIgnoringBody joinsGroupFormations useAsTransport useAsHarvester disableUse whenUsingAsHarvester_includeOtherHarvesterCounts ai_isDisabled ai_isHighPriority ai_considerSameAsBuilding allowMultipleInQueue onlyOneUnitAtATime isGuiBlinking highPriorityQueue canPlayerCancel whenBuilding_cannotMove whenBuilding_rotateTo_waitTillRotated deleteSelf finishPlayingLastAnimation clearAllWaypoints clearActiveWaypoint forceUnloadTransportNow startUnloadingTransport switchToNeutralTeam switchToAggressiveTeam disconnectFromParent hidden drawOverBody drawUnderAllUnits favourOppositeSideNeighbours draw_foot_on_top lockMovement lockLegMovement keepAliveWhenParentDies setDrawLayerOnTop setDrawLayerOnBottom lockRotation rotateWithParent resetRotationWhenNotAttacking deattachIfWantingToMove prioritizeParentsMainTarget alwaysAllowedToAttackParentsMainTargetWill onParentTeamChangeKeepCurrentTeam canBeAttackedAndDamaged createWhenOffscreen createWhenZoomedOut createWhenOverLiquid createWhenOverLand showInFog liveAfterAttachedDies attachedToUnit alwayStartDirAtZero atmospheric physics shadow animateFramePingPong pingPong forceNano'.split(' '));
// 数值：名字里带这些词、且不在布尔表里的才当数字
const NUM_RX = /(Rate|Speed|Range|Damage|Radius|Delay|Time|Height|Scale|Spread|Amount|Multiplier|Chance|Alpha|Cooldown|Offset|Size|Life|Hp|Shield|Armour|Energy|Max|Num|Count|Slots|Price|Gravity|Frame|Priority|Power|Distance|Angle|Warmup)(?!.*(Image|Effect|Sound|Tag|Unit|Type|Text|Message|Condition|Action))/;
for (const [sec, list] of Object.entries(EXT_KEYS)) {
  const have = new Set((SCHEMA[sec] || []).map((d) => d.key));
  for (const key of list.split(' ')) {
    if (have.has(key)) continue;
    have.add(key);
    const type = EXT_BOOL.has(key) ? 'b' : NUM_RX.test(key) && !/^(is|can|show|dont|disable|use)/.test(key) ? 'n' : 's';
    (SCHEMA[sec] = SCHEMA[sec] || []).push(f(key, EXT_LABEL[key] || key, type, EXT_LABEL[key] ? '' : '官方文档键名，暂无中文说明'));
  }
}
// 条件表达式可能写在这些键里，不能当布尔下拉
for (const d of SCHEMA.canBuild) if (d.key === 'isLocked' || d.key === 'isVisible') d.type = 's';
for (const d of SCHEMA.turret) if (d.key === 'canShoot') d.type = 's';
for (const d of SCHEMA.action) if (['isActive', 'isVisible', 'isLocked'].includes(d.key)) d.type = 's';
for (const d of SCHEMA.core) if (d.key === 'isLocked') d.type = 's';

export const SECTION_LABEL = {
  core: '基本', graphics: '图像', movement: '移动', attack: '攻击', turret: '炮塔', projectile: '弹道',
  ai: 'AI', arm: '手臂', decal: '贴花', placementRule: '放置规则', canBuild: '可建造', action: '按钮动作', effect: '特效', resource: '资源', animation: '动画', attachment: '附件', leg: '腿', global_resource: '全局资源', template: '模板',
};
// 'turret_main' → 'turret'
export function schemaKey(secName) {
  const m = /^([A-Za-z]+)(_.*)?$/.exec(secName || '');
  if (!m) return null;
  const k = m[1] === 'hiddenAction' ? 'action' : m[1];
  return k in SCHEMA ? k : null;
}
export const KNOWN_SECTIONS = new Set(Object.keys(SCHEMA).concat(['hiddenAction']));
// 关键数值，列表里显示
export const SUMMARY = [['core', 'price'], ['core', 'maxHp'], ['movement', 'moveSpeed'], ['movement', 'movementType']];
