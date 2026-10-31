// 内置中文简介。优先用于离线演示；真实模组会先查本地缓存，再调用在线翻译。
export const BUILTIN_TRANSLATIONS = {
  ModuleManager: {
    abstract: '一个强大的配置补丁引擎，让模组无需修改原版文件即可调整 KSP 配置。',
    description: 'ModuleManager 会在游戏启动时读取散落在 GameData 中的补丁文件，并把它们合并进最终配置。大量模组依赖它来添加部件、调整参数或修复原版数据，因此通常应当最先安装。',
  },
  Harmony: {
    abstract: '一个运行时补丁库，让 KSP 模组在启动时安全地应用代码补丁。',
    description: 'Harmony 提供方法替换、前后缀和转译器等补丁能力，是许多现代 KSP 插件的基础依赖。安装后通常不需要额外设置，保持版本较新即可。',
  },
  KSPCommunityFixes: {
    abstract: '由社区维护的 KSP 1.12 错误修复与体验改进合集。',
    description: '这个模组集中修复了原版中若干长期存在的问题，并加入了少量可选的体验改进。它依赖 ModuleManager，通常可以直接与大多数模组共存。',
  },
  DemoBroken: {
    abstract: '一个故意损坏的演示模组，用来展示 kanmod 的问题诊断与自动修复。',
    description: '它声明依赖 Harmony，但演示实例中并没有安装 Harmony，因此日志里会出现程序集加载失败。点击问题诊断中的一键修复即可补齐依赖。',
  },
  Waterfall: {
    abstract: '为 KSP 引擎尾焰加入更真实、可配置的视觉特效。',
    description: 'Waterfall 使用可配置的尾焰模型和着色器替换原版效果，让不同引擎拥有更丰富的视觉表现。它需要 ModuleManager 才能加载配置。',
  },
  Scatterer: {
    abstract: '为 KSP 提供大气散射、海洋着色与更真实的天空视觉效果。',
    description: 'Scatterer 会重写大气与海洋渲染，让从轨道到地面的过渡更自然。它对显卡有一定要求，并可能与其它大气渲染模组冲突。',
  },
  OldParts: {
    abstract: '来自旧版 KSP 的部件包，用来展示版本兼容性提示。',
    description: '这个演示包只声明支持 KSP 1.10.1，因此在 1.12.5 实例中会显示为可能不兼容。kanmod 不会默认把它加入安装计划。',
  },
};
