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
  effect: [], resource: [], animation: [], attachment: [], leg: [],
};
export const SECTION_LABEL = {
  core: '基本', graphics: '图像', movement: '移动', attack: '攻击', turret: '炮塔', projectile: '弹道',
  ai: 'AI', canBuild: '可建造', action: '按钮动作', effect: '特效', resource: '资源', animation: '动画', attachment: '附件', leg: '腿',
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
