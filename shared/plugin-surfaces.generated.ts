/** 由 scripts/sync-plugin-catalog.ts 生成的界面及请求归属投影。 */
import type {PluginSurface} from './plugin-surface-queries.ts';
export const PLUGIN_SURFACES:PluginSurface[]=[
  {
    "id": "app-config",
    "name": "应用配置",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "app-config"
      ],
      "http": [
        {
          "path": "/api/app-config",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "app-data",
    "name": "应用持久数据",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "app-data"
      ],
      "http": [
        {
          "path": "/api/app-data",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "app-deploy",
    "name": "应用安装变更",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "app-deploy"
      ],
      "http": [
        {
          "path": "/api/app-deploy",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "app-observe",
    "name": "应用观测",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "app-observe"
      ],
      "http": [
        {
          "path": "/api/app-observe",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "app-packages",
    "name": "应用安装制品",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "app-packages"
      ],
      "http": [
        {
          "path": "/api/app-packages",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "app-recovery",
    "name": "应用冷备恢复",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "app-recovery"
      ],
      "http": [
        {
          "path": "/api/app-recovery",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "app-routes",
    "name": "应用入口",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "app-routes"
      ],
      "http": [
        {
          "path": "/api/app-routes",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "app-targets",
    "name": "应用运行目标",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "app-targets"
      ],
      "http": [
        {
          "path": "/api/app-targets",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "app-workbench",
    "name": "应用运行工作台",
    "contributes": {
      "pages": [
        "app-runtime"
      ],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "app-workbench"
      ],
      "http": [
        {
          "path": "/api/app-workbench",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "automation",
    "name": "自动化与运维",
    "contributes": {
      "pages": [
        "features"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/feature-suite",
          "methods": [
            "GET"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/advanced",
          "methods": [
            "GET",
            "PUT",
            "POST"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/packages",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/suspend",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/resume",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "automation-scheduler",
    "name": "自动化调度",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": []
    }
  },
  {
    "id": "backups",
    "name": "备份策略",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/vms/:vmId/backups",
          "methods": [
            "GET",
            "PUT",
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/backup-download",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/backup-recovery",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "browser-accessibility",
    "name": "可访问性检查",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/browser-accessibility",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "browser-assertions",
    "name": "浏览器断言",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/browser-assertions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "browser-exchange",
    "name": "浏览器交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/browser-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "browser-fixtures",
    "name": "合成会话数据",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/browser-fixtures",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "browser-journeys",
    "name": "浏览器旅程",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/browser-journeys",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "browser-reports",
    "name": "浏览器验收报告",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/browser-reports",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "browser-runners",
    "name": "浏览器运行",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/browser-runners",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "browser-targets",
    "name": "浏览器目标",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/browser-targets",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "browser-visual",
    "name": "视觉基线",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/browser-visual",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "browser-workbench",
    "name": "浏览器验收工作台",
    "contributes": {
      "pages": [
        "browser-lab"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/browser-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "code-checks",
    "name": "代码与调试工具",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/vms/:vmId/code-diagnostics",
          "methods": [
            "GET"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/language-service",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/debugger",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": true
        }
      ]
    }
  },
  {
    "id": "command-palette",
    "name": "快捷命令面板",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": []
    }
  },
  {
    "id": "commands",
    "name": "收藏命令",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "commands"
      ],
      "http": [
        {
          "path": "/api/vms/:vmId/commands",
          "methods": [
            "GET",
            "PUT",
            "DELETE",
            "POST"
          ],
          "projectScoped": true
        }
      ]
    }
  },
  {
    "id": "containers",
    "name": "容器工作台",
    "contributes": {
      "pages": [],
      "tabs": [
        "containers"
      ],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/vms/:vmId/containers",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": true
        }
      ]
    }
  },
  {
    "id": "csolve-conflicts",
    "name": "冲突解释",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/csolve-conflicts",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "csolve-constraints",
    "name": "约束模型",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/csolve-constraints",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "csolve-decisions",
    "name": "方案接受",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/csolve-decisions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "csolve-domains",
    "name": "取值域",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/csolve-domains",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "csolve-exchange",
    "name": "方案交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/csolve-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "csolve-objectives",
    "name": "目标模型",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/csolve-objectives",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "csolve-runs",
    "name": "求解任务",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/csolve-runs",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "csolve-scenarios",
    "name": "情景版本",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/csolve-scenarios",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "csolve-sensitivity",
    "name": "情景比较",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/csolve-sensitivity",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "csolve-solutions",
    "name": "候选方案",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/csolve-solutions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "csolve-spaces",
    "name": "求解空间",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/csolve-spaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "csolve-validation",
    "name": "独立验证",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/csolve-validation",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "csolve-variables",
    "name": "决策变量",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/csolve-variables",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "csolve-workbench",
    "name": "求解工作台",
    "contributes": {
      "pages": [
        "constraint-solver-studio"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/csolve-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ctrain-comparisons",
    "name": "候选比较",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ctrain-comparisons",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ctrain-datasets",
    "name": "训练材料",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ctrain-datasets",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ctrain-estimators",
    "name": "算法配方",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ctrain-estimators",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ctrain-exchange",
    "name": "模型交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ctrain-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ctrain-explanations",
    "name": "模型解释",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ctrain-explanations",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ctrain-metrics",
    "name": "评估指标",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ctrain-metrics",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ctrain-partitions",
    "name": "评估分区",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ctrain-partitions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ctrain-predictions",
    "name": "固定预测",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ctrain-predictions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ctrain-registry",
    "name": "模型登记",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ctrain-registry",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ctrain-reports",
    "name": "训练报告",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ctrain-reports",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ctrain-runs",
    "name": "训练任务",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ctrain-runs",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ctrain-searches",
    "name": "候选搜索",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ctrain-searches",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ctrain-spaces",
    "name": "训练空间",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ctrain-spaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ctrain-targets",
    "name": "学习目标",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ctrain-targets",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ctrain-workbench",
    "name": "训练工作台",
    "contributes": {
      "pages": [
        "classical-training-lab"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ctrain-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "data-datasets",
    "name": "数据版本",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "data-datasets"
      ],
      "http": [
        {
          "path": "/api/data-datasets",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "data-exchange",
    "name": "数据交接",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "data-exchange"
      ],
      "http": [
        {
          "path": "/api/data-exchange",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "data-experiments",
    "name": "参数实验",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "data-experiments"
      ],
      "http": [
        {
          "path": "/api/data-experiments",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "data-lineage",
    "name": "血缘与比较",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "data-lineage"
      ],
      "http": [
        {
          "path": "/api/data-lineage",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "data-notebooks",
    "name": "Notebook",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "data-notebooks"
      ],
      "http": [
        {
          "path": "/api/data-notebooks",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "data-quality",
    "name": "质量验证",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "data-quality"
      ],
      "http": [
        {
          "path": "/api/data-quality",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "data-runtime",
    "name": "数据环境",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "data-runtime"
      ],
      "http": [
        {
          "path": "/api/data-runtime",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "data-sources",
    "name": "数据来源",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "data-sources"
      ],
      "http": [
        {
          "path": "/api/data-sources",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "data-transforms",
    "name": "SQL 变换",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "data-transforms"
      ],
      "http": [
        {
          "path": "/api/data-transforms",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "data-workbench",
    "name": "数据工作台",
    "contributes": {
      "pages": [
        "data-lab"
      ],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "data-workbench"
      ],
      "http": [
        {
          "path": "/api/data-workbench",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "database-changes",
    "name": "声明式变更",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/database-changes",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "database-checks",
    "name": "完整数据检查",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/database-checks",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "database-exchange",
    "name": "数据库交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/database-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "database-fixtures",
    "name": "独立数据库副本",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/database-fixtures",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "database-rehearsals",
    "name": "数据库恢复演练",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/database-rehearsals",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "database-reports",
    "name": "演练报告",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/database-reports",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "database-runners",
    "name": "数据库执行",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/database-runners",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "database-schemas",
    "name": "数据库结构",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/database-schemas",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "database-sources",
    "name": "数据库材料",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/database-sources",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "database-workbench",
    "name": "数据库演进工作台",
    "contributes": {
      "pages": [
        "database-evolution"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/database-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "delivery-artifacts",
    "name": "制品仓库",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "delivery-artifacts"
      ],
      "http": [
        {
          "path": "/api/delivery-artifacts",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "delivery-gates",
    "name": "交付规则",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "delivery-gates"
      ],
      "http": [
        {
          "path": "/api/delivery-gates",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "delivery-inputs",
    "name": "输入快照",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "delivery-inputs"
      ],
      "http": [
        {
          "path": "/api/delivery-inputs",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "delivery-previews",
    "name": "候选预览",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "delivery-previews"
      ],
      "http": [
        {
          "path": "/api/delivery-previews",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "delivery-releases",
    "name": "本地版本",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "delivery-releases"
      ],
      "http": [
        {
          "path": "/api/delivery-releases",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "delivery-reports",
    "name": "验证报告",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "delivery-reports"
      ],
      "http": [
        {
          "path": "/api/delivery-reports",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "delivery-runners",
    "name": "隔离执行",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "delivery-runners"
      ],
      "http": [
        {
          "path": "/api/delivery-runners",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "delivery-workbench",
    "name": "交付工作台",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "delivery-workbench"
      ],
      "http": [
        {
          "path": "/api/delivery-workbench",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "depsolve-candidates",
    "name": "候选策略",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/depsolve-candidates",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "depsolve-catalogs",
    "name": "固定仓库",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/depsolve-catalogs",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "depsolve-comparisons",
    "name": "方案对比",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/depsolve-comparisons",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "depsolve-constraints",
    "name": "约束模型",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/depsolve-constraints",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "depsolve-exchange",
    "name": "求解交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/depsolve-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "depsolve-locks",
    "name": "锁定计划",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/depsolve-locks",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "depsolve-platforms",
    "name": "目标档案",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/depsolve-platforms",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "depsolve-proofs",
    "name": "结果核验",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/depsolve-proofs",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "depsolve-reports",
    "name": "求解报告",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/depsolve-reports",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "depsolve-roots",
    "name": "根需求",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/depsolve-roots",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "depsolve-solves",
    "name": "求解运行",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/depsolve-solves",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "depsolve-spaces",
    "name": "求解空间",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/depsolve-spaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "depsolve-workbench",
    "name": "依赖工作台",
    "contributes": {
      "pages": [
        "dependency-resolution-studio"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/depsolve-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "desktop",
    "name": "Linux 图形桌面",
    "contributes": {
      "pages": [],
      "tabs": [
        "desktop"
      ],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/vms/:vmId/desktop",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/single-app",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/x11-clipboard",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/wayland-clipboard",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/ime",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dextract-checks",
    "name": "结果检查",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dextract-checks",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dextract-corrections",
    "name": "人工纠错",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dextract-corrections",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dextract-datasets",
    "name": "数据版本",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dextract-datasets",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dextract-exchange",
    "name": "提取交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dextract-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dextract-fields",
    "name": "字段提取",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dextract-fields",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dextract-layouts",
    "name": "版面区域",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dextract-layouts",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dextract-ocr",
    "name": "字符识别",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dextract-ocr",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dextract-pages",
    "name": "页面拆解",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dextract-pages",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dextract-reviews",
    "name": "提取复核",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dextract-reviews",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dextract-schemas",
    "name": "字段约定",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dextract-schemas",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dextract-sources",
    "name": "原文材料",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dextract-sources",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dextract-spaces",
    "name": "提取空间",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dextract-spaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dextract-tables",
    "name": "表格重建",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dextract-tables",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dextract-workbench",
    "name": "提取工作台",
    "contributes": {
      "pages": [
        "document-extraction-studio"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dextract-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dsys-builds",
    "name": "产物编译",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dsys-builds",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dsys-checks",
    "name": "系统检查",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dsys-checks",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dsys-components",
    "name": "组件规格",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dsys-components",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dsys-exchange",
    "name": "系统交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dsys-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dsys-icons",
    "name": "图标资源",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dsys-icons",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dsys-layouts",
    "name": "版式样例",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dsys-layouts",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dsys-reviews",
    "name": "版本复核",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dsys-reviews",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dsys-spaces",
    "name": "系统空间",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dsys-spaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dsys-states",
    "name": "状态矩阵",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dsys-states",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dsys-themes",
    "name": "主题集合",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dsys-themes",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dsys-tokens",
    "name": "设计变量",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dsys-tokens",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dsys-typography",
    "name": "排版规格",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dsys-typography",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "dsys-workbench",
    "name": "系统工作台",
    "contributes": {
      "pages": [
        "design-system-studio"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/dsys-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "entitydesk-blocks",
    "name": "候选分组",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/entitydesk-blocks",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "entitydesk-candidates",
    "name": "候选对",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/entitydesk-candidates",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "entitydesk-clusters",
    "name": "候选簇",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/entitydesk-clusters",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "entitydesk-comparators",
    "name": "比较器版本",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/entitydesk-comparators",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "entitydesk-constraints",
    "name": "合并约束",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/entitydesk-constraints",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "entitydesk-decisions",
    "name": "人工裁决",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/entitydesk-decisions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "entitydesk-evaluations",
    "name": "匹配复核",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/entitydesk-evaluations",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "entitydesk-exchange",
    "name": "归并交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/entitydesk-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "entitydesk-normalization",
    "name": "标准化规则",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/entitydesk-normalization",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "entitydesk-reports",
    "name": "归并档案",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/entitydesk-reports",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "entitydesk-sources",
    "name": "原始台账",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/entitydesk-sources",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "entitydesk-spaces",
    "name": "归并空间",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/entitydesk-spaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "entitydesk-survivors",
    "name": "字段取值",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/entitydesk-survivors",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "entitydesk-versions",
    "name": "规范实体版本",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/entitydesk-versions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "entitydesk-workbench",
    "name": "归并工作台",
    "contributes": {
      "pages": [
        "entity-resolution-studio"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/entitydesk-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "evaluation-comparisons",
    "name": "配对比较",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/evaluation-comparisons",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "evaluation-datasets",
    "name": "样例集合",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/evaluation-datasets",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "evaluation-endpoints",
    "name": "本机模型端点",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/evaluation-endpoints",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "evaluation-exchange",
    "name": "评测隔离交换",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/evaluation-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "evaluation-prompts",
    "name": "固定提示词",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/evaluation-prompts",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "evaluation-reports",
    "name": "评测报告",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/evaluation-reports",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "evaluation-reviews",
    "name": "评测审阅",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/evaluation-reviews",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "evaluation-runners",
    "name": "模型评测运行",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/evaluation-runners",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "evaluation-scorers",
    "name": "评测评分",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/evaluation-scorers",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "evaluation-workbench",
    "name": "模型评测工作台",
    "contributes": {
      "pages": [
        "model-evaluation"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/evaluation-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "event-assertions",
    "name": "消息语义断言",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/event-assertions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "event-brokers",
    "name": "隔离测试代理",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/event-brokers",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "event-consumers",
    "name": "消费与幂等策略",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/event-consumers",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "event-contracts",
    "name": "事件模式与材料",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/event-contracts",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "event-exchange",
    "name": "事件交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/event-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "event-fixtures",
    "name": "固定消息样例",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/event-fixtures",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "event-producers",
    "name": "固定生产计划",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/event-producers",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "event-reports",
    "name": "事件实验报告",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/event-reports",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "event-runs",
    "name": "事件执行记录",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/event-runs",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "event-scenarios",
    "name": "事件场景",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/event-scenarios",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "event-workbench",
    "name": "事件与队列工作台",
    "contributes": {
      "pages": [
        "event-lab"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/event-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "extensions",
    "name": "工程扩展适配器",
    "contributes": {
      "pages": [
        "features"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/extended-features",
          "methods": [
            "GET"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/extended-features",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": true
        }
      ]
    }
  },
  {
    "id": "extforge-builds",
    "name": "受控编译",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/extforge-builds",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "extforge-bundles",
    "name": "发行候选",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/extforge-bundles",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "extforge-cases",
    "name": "用例材料",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/extforge-cases",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "extforge-catalogs",
    "name": "目录预演",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/extforge-catalogs",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "extforge-exchange",
    "name": "工坊交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/extforge-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "extforge-inspections",
    "name": "模块检查",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/extforge-inspections",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "extforge-interfaces",
    "name": "表单接口",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/extforge-interfaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "extforge-manifests",
    "name": "扩展声明",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/extforge-manifests",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "extforge-reports",
    "name": "开发报告",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/extforge-reports",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "extforge-reviews",
    "name": "发布审阅",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/extforge-reviews",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "extforge-signatures",
    "name": "签名核对",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/extforge-signatures",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "extforge-sources",
    "name": "源码材料",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/extforge-sources",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "extforge-spaces",
    "name": "开发空间",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/extforge-spaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "extforge-toolchains",
    "name": "工具档案",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/extforge-toolchains",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "extforge-trials",
    "name": "沙箱试运行",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/extforge-trials",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "extforge-workbench",
    "name": "开发工作台",
    "contributes": {
      "pages": [
        "extension-authoring-studio"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/extforge-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "feat-artifacts",
    "name": "特征版本",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/feat-artifacts",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "feat-checks",
    "name": "泄漏与结果检查",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/feat-checks",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "feat-exchange",
    "name": "特征交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/feat-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "feat-fits",
    "name": "拟合参数",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/feat-fits",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "feat-joins",
    "name": "关联配方",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/feat-joins",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "feat-partitions",
    "name": "样本分区",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/feat-partitions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "feat-reviews",
    "name": "使用复核",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/feat-reviews",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "feat-runs",
    "name": "特征生成",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/feat-runs",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "feat-schemas",
    "name": "特征类型",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/feat-schemas",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "feat-selections",
    "name": "特征选择",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/feat-selections",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "feat-sources",
    "name": "表格来源",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/feat-sources",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "feat-spaces",
    "name": "特征空间",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/feat-spaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "feat-transforms",
    "name": "变换配方",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/feat-transforms",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "feat-windows",
    "name": "历史窗口",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/feat-windows",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "feat-workbench",
    "name": "特征工作台",
    "contributes": {
      "pages": [
        "feature-engineering-studio"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/feat-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "fform-exchange",
    "name": "表单交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/fform-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "fform-fields",
    "name": "字段目录",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/fform-fields",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "fform-fixtures",
    "name": "样例材料",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/fform-fixtures",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "fform-logic",
    "name": "条件逻辑",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/fform-logic",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "fform-pages",
    "name": "步骤编排",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/fform-pages",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "fform-previews",
    "name": "交互预览",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/fform-previews",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "fform-reviews",
    "name": "表单复核",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/fform-reviews",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "fform-schemas",
    "name": "数据约定",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/fform-schemas",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "fform-spaces",
    "name": "表单空间",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/fform-spaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "fform-submissions",
    "name": "试填记录",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/fform-submissions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "fform-validations",
    "name": "校验执行",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/fform-validations",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "fform-versions",
    "name": "表单版本",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/fform-versions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "fform-workbench",
    "name": "表单工作台",
    "contributes": {
      "pages": [
        "form-flow-studio"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/fform-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "files",
    "name": "文件工作台",
    "contributes": {
      "pages": [],
      "tabs": [
        "files"
      ],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/vms/:vmId/files",
          "methods": [
            "GET"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/file",
          "methods": [
            "GET",
            "PUT"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/file-lock",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/history",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/transfer",
          "methods": [
            "GET",
            "PUT"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/file-operation",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/uploads",
          "methods": [
            "GET",
            "POST",
            "PUT",
            "DELETE"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/file-preview",
          "methods": [
            "GET"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/download-chunks",
          "methods": [
            "GET"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "flow-approvals",
    "name": "阶段批准",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/flow-approvals",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "flow-connectors",
    "name": "原服务连接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/flow-connectors",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "flow-definitions",
    "name": "流程定义",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/flow-definitions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "flow-exchange",
    "name": "流程交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/flow-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "flow-inputs",
    "name": "流程输入",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/flow-inputs",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "flow-journal",
    "name": "流程事件",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/flow-journal",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "flow-plans",
    "name": "阶段计划",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/flow-plans",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "flow-runs",
    "name": "流程运行",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/flow-runs",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "flow-timers",
    "name": "流程等待",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/flow-timers",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "flow-workbench",
    "name": "流程工作台",
    "contributes": {
      "pages": [
        "flow-studio"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/flow-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "foundry-blueprints",
    "name": "环境蓝图",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "foundry-blueprints"
      ],
      "http": [
        {
          "path": "/api/foundry-blueprints",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "foundry-builders",
    "name": "镜像制作",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "foundry-builders"
      ],
      "http": [
        {
          "path": "/api/foundry-builders",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "foundry-catalog",
    "name": "环境镜像库",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "foundry-catalog"
      ],
      "http": [
        {
          "path": "/api/foundry-catalog",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "foundry-checks",
    "name": "镜像验收",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "foundry-checks"
      ],
      "http": [
        {
          "path": "/api/foundry-checks",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "foundry-depot",
    "name": "离线材料",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "foundry-depot"
      ],
      "http": [
        {
          "path": "/api/foundry-depot",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "foundry-exchange",
    "name": "镜像交接",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "foundry-exchange"
      ],
      "http": [
        {
          "path": "/api/foundry-exchange",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "foundry-sanitizers",
    "name": "身份清理",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "foundry-sanitizers"
      ],
      "http": [
        {
          "path": "/api/foundry-sanitizers",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "foundry-sources",
    "name": "镜像来源",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "foundry-sources"
      ],
      "http": [
        {
          "path": "/api/foundry-sources",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "foundry-workbench",
    "name": "镜像工坊",
    "contributes": {
      "pages": [
        "foundry"
      ],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "foundry-workbench"
      ],
      "http": [
        {
          "path": "/api/foundry-workbench",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "geodesk-crs",
    "name": "坐标档案",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/geodesk-crs",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "geodesk-exchange",
    "name": "图层交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/geodesk-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "geodesk-indexes",
    "name": "空间索引",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/geodesk-indexes",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "geodesk-joins",
    "name": "空间连接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/geodesk-joins",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "geodesk-layers",
    "name": "图层版本",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/geodesk-layers",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "geodesk-measures",
    "name": "地理计量",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/geodesk-measures",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "geodesk-operations",
    "name": "几何操作",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/geodesk-operations",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "geodesk-reports",
    "name": "地理档案",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/geodesk-reports",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "geodesk-reviews",
    "name": "地图复核",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/geodesk-reviews",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "geodesk-runs",
    "name": "空间计算",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/geodesk-runs",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "geodesk-sources",
    "name": "地理材料",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/geodesk-sources",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "geodesk-spaces",
    "name": "地理空间",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/geodesk-spaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "geodesk-styles",
    "name": "地图样式",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/geodesk-styles",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "geodesk-validation",
    "name": "几何检查",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/geodesk-validation",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "geodesk-workbench",
    "name": "地理工作台",
    "contributes": {
      "pages": [
        "geospatial-studio"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/geodesk-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "git",
    "name": "Git 工作台",
    "contributes": {
      "pages": [],
      "tabs": [
        "git"
      ],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/vms/:vmId/git",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": true
        }
      ]
    }
  },
  {
    "id": "graphdesk-algorithms",
    "name": "算法档案",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/graphdesk-algorithms",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "graphdesk-annotations",
    "name": "结果复核",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/graphdesk-annotations",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "graphdesk-comparisons",
    "name": "结构比较",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/graphdesk-comparisons",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "graphdesk-edges",
    "name": "关系目录",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/graphdesk-edges",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "graphdesk-entities",
    "name": "节点目录",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/graphdesk-entities",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "graphdesk-exchange",
    "name": "关系图交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/graphdesk-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "graphdesk-projections",
    "name": "图投影",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/graphdesk-projections",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "graphdesk-queries",
    "name": "路径查询",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/graphdesk-queries",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "graphdesk-reports",
    "name": "图分析档案",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/graphdesk-reports",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "graphdesk-runs",
    "name": "图计算",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/graphdesk-runs",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "graphdesk-sources",
    "name": "图材料",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/graphdesk-sources",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "graphdesk-spaces",
    "name": "关系空间",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/graphdesk-spaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "graphdesk-views",
    "name": "图视图",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/graphdesk-views",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "graphdesk-workbench",
    "name": "关系图工作台",
    "contributes": {
      "pages": [
        "graph-insight-studio"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/graphdesk-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ide",
    "name": "IDE 接入",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/vms/:vmId/ide",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": true
        }
      ]
    }
  },
  {
    "id": "images",
    "name": "发行版镜像",
    "contributes": {
      "pages": [
        "images"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/images",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/image-import",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "incident-actions",
    "name": "事件处置",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/incident-actions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "incident-cases",
    "name": "事件案例",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/incident-cases",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "incident-evidence",
    "name": "事件证据",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/incident-evidence",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "incident-exchange",
    "name": "事件复盘交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/incident-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "incident-hypotheses",
    "name": "事件假设",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/incident-hypotheses",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "incident-reports",
    "name": "事件复盘报告",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/incident-reports",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "incident-reviews",
    "name": "事件复盘审阅",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/incident-reviews",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "incident-runbooks",
    "name": "事件处置手册",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/incident-runbooks",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "incident-timeline",
    "name": "事件时间线",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/incident-timeline",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "incident-workbench",
    "name": "事件复盘工作台",
    "contributes": {
      "pages": [
        "incident-desk"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/incident-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "integration-assertions",
    "name": "响应断言",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "integration-assertions"
      ],
      "http": [
        {
          "path": "/api/integration-assertions",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "integration-environments",
    "name": "测试环境",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "integration-environments"
      ],
      "http": [
        {
          "path": "/api/integration-environments",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "integration-exchange",
    "name": "离线交接",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "integration-exchange"
      ],
      "http": [
        {
          "path": "/api/integration-exchange",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "integration-fixtures",
    "name": "固定样例",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "integration-fixtures"
      ],
      "http": [
        {
          "path": "/api/integration-fixtures",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "integration-load",
    "name": "模拟有限负载",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "integration-load"
      ],
      "http": [
        {
          "path": "/api/integration-load",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "integration-mocks",
    "name": "有限状态模拟",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "integration-mocks"
      ],
      "http": [
        {
          "path": "/api/integration-mocks",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "integration-reports",
    "name": "验证报告",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "integration-reports"
      ],
      "http": [
        {
          "path": "/api/integration-reports",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "integration-runners",
    "name": "隔离运行",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "integration-runners"
      ],
      "http": [
        {
          "path": "/api/integration-runners",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "integration-scenarios",
    "name": "请求场景",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "integration-scenarios"
      ],
      "http": [
        {
          "path": "/api/integration-scenarios",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "integration-specs",
    "name": "契约与工作空间",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "integration-specs"
      ],
      "http": [
        {
          "path": "/api/integration-specs",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "integration-workbench",
    "name": "接口集成工作台",
    "contributes": {
      "pages": [
        "integration-lab"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/integration-workbench",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "knowledge-documents",
    "name": "模板文稿",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/knowledge-documents",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "knowledge-entries",
    "name": "知识条目",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/knowledge-entries",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "knowledge-evidence",
    "name": "引用证据",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/knowledge-evidence",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "knowledge-exchange",
    "name": "离线交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/knowledge-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "knowledge-extract",
    "name": "固定解析",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/knowledge-extract",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "knowledge-index",
    "name": "固定索引",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/knowledge-index",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "knowledge-publish",
    "name": "本机阅读",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/knowledge-publish",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "knowledge-reviews",
    "name": "人工审阅",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/knowledge-reviews",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "knowledge-sources",
    "name": "材料与许可",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/knowledge-sources",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "knowledge-workbench",
    "name": "知识工作台",
    "contributes": {
      "pages": [
        "knowledge-studio"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/knowledge-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "learning-assessments",
    "name": "自学评估",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/learning-assessments",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "learning-assets",
    "name": "课件与镜像",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/learning-assets",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "learning-checks",
    "name": "课内检查",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/learning-checks",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "learning-courses",
    "name": "课程与顺序",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/learning-courses",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "learning-environments",
    "name": "环境与检查点",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/learning-environments",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "learning-exchange",
    "name": "学习资料交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/learning-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "learning-lessons",
    "name": "课节与目标",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/learning-lessons",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "learning-progress",
    "name": "学习进度",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/learning-progress",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "learning-sessions",
    "name": "真实学习会话",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/learning-sessions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "learning-steps",
    "name": "固定学习动作",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/learning-steps",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "learning-workbench",
    "name": "交互式实验",
    "contributes": {
      "pages": [
        "learning-lab"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/learning-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "library",
    "name": "实例整理",
    "contributes": {
      "pages": [
        "library"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/vms/batch",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/organization",
          "methods": [
            "PUT"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "lineageatlas-assertions",
    "name": "血缘证据",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/lineageatlas-assertions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "lineageatlas-assets",
    "name": "资产身份",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/lineageatlas-assets",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "lineageatlas-catalogs",
    "name": "来源目录",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/lineageatlas-catalogs",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "lineageatlas-exchange",
    "name": "血缘交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/lineageatlas-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "lineageatlas-graphs",
    "name": "图版本",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/lineageatlas-graphs",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "lineageatlas-impacts",
    "name": "变更影响",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/lineageatlas-impacts",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "lineageatlas-investigations",
    "name": "调查记录",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/lineageatlas-investigations",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "lineageatlas-mappings",
    "name": "字段映射",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/lineageatlas-mappings",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "lineageatlas-processes",
    "name": "处理步骤",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/lineageatlas-processes",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "lineageatlas-reports",
    "name": "血缘档案",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/lineageatlas-reports",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "lineageatlas-reviews",
    "name": "图复核",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/lineageatlas-reviews",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "lineageatlas-spaces",
    "name": "血缘空间",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/lineageatlas-spaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "lineageatlas-workbench",
    "name": "血缘工作台",
    "contributes": {
      "pages": [
        "lineage-atlas"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/lineageatlas-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "locale-catalogs",
    "name": "语言目录",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/locale-catalogs",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "locale-checks",
    "name": "文案质量检查",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/locale-checks",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "locale-contexts",
    "name": "文案上下文",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/locale-contexts",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "locale-exchange",
    "name": "本地化交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/locale-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "locale-previews",
    "name": "固定组件预览",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/locale-previews",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "locale-releases",
    "name": "本机语言版本",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/locale-releases",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "locale-reviews",
    "name": "文案审阅",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/locale-reviews",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "locale-terminology",
    "name": "本地化术语",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/locale-terminology",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "locale-translations",
    "name": "译文与记忆",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/locale-translations",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "locale-workbench",
    "name": "本地化工作台",
    "contributes": {
      "pages": [
        "localization-studio"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/locale-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "maintenance",
    "name": "磁盘与诊断",
    "contributes": {
      "pages": [],
      "tabs": [
        "maintenance"
      ],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/cleanup",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/storage",
          "methods": [
            "GET"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/diagnostics",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/resize",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/compact",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/disk-maintenance",
          "methods": [
            "GET",
            "PUT",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "media-captions",
    "name": "手工字幕",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/media-captions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "media-collections",
    "name": "资源集合",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/media-collections",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "media-exchange",
    "name": "媒体资源交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/media-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "media-inspect",
    "name": "媒体事实探测",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/media-inspect",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "media-recipes",
    "name": "固定媒体配方",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/media-recipes",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "media-reviews",
    "name": "媒体人工审核",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/media-reviews",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "media-sources",
    "name": "媒体材料",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/media-sources",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "media-workbench",
    "name": "媒体制作工作台",
    "contributes": {
      "pages": [
        "media-studio"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/media-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "media-workers",
    "name": "媒体处理任务",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/media-workers",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "metrics",
    "name": "资源采样",
    "contributes": {
      "pages": [],
      "tabs": [
        "metrics"
      ],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/vms/:vmId/metrics",
          "methods": [
            "GET"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "migration",
    "name": "数据目录迁移",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/migration",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "network",
    "name": "网络管理",
    "contributes": {
      "pages": [],
      "tabs": [
        "services",
        "development"
      ],
      "developmentSections": [
        "network"
      ],
      "http": [
        {
          "path": "/api/network-profiles",
          "methods": [
            "GET",
            "POST",
            "DELETE"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/network",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/services",
          "methods": [
            "GET",
            "PATCH"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/ingress",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/ingress-certificate",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/local-aliases",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ntpl-assets",
    "name": "模板资产",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ntpl-assets",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ntpl-audiences",
    "name": "合成收件人",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ntpl-audiences",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ntpl-channels",
    "name": "渠道档案",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ntpl-channels",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ntpl-checks",
    "name": "内容检查",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ntpl-checks",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ntpl-exchange",
    "name": "通知交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ntpl-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ntpl-inboxes",
    "name": "虚拟收件箱",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ntpl-inboxes",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ntpl-locales",
    "name": "语言变体",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ntpl-locales",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ntpl-releases",
    "name": "模板版本",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ntpl-releases",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ntpl-renders",
    "name": "固定渲染",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ntpl-renders",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ntpl-rules",
    "name": "内容选择",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ntpl-rules",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ntpl-spaces",
    "name": "通知空间",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ntpl-spaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ntpl-templates",
    "name": "内容模板",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ntpl-templates",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ntpl-variables",
    "name": "变量约定",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ntpl-variables",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "ntpl-workbench",
    "name": "通知工作台",
    "contributes": {
      "pages": [
        "notification-template-studio"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/ntpl-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "pipelines",
    "name": "项目流水线",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "pipelines"
      ],
      "http": [
        {
          "path": "/api/vms/:vmId/pipelines",
          "methods": [
            "GET",
            "PUT",
            "DELETE",
            "POST"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/pipeline-artifact",
          "methods": [
            "POST"
          ],
          "projectScoped": true
        }
      ]
    }
  },
  {
    "id": "platform",
    "name": "平台扩展适配器",
    "contributes": {
      "pages": [
        "features"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/next-features",
          "methods": [
            "GET"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/next-features",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/notebook-link",
          "methods": [
            "GET"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/browser-ide-link",
          "methods": [
            "GET"
          ],
          "projectScoped": true
        }
      ]
    }
  },
  {
    "id": "project-search",
    "name": "项目搜索",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/vms/:vmId/project-files",
          "methods": [
            "GET"
          ],
          "projectScoped": true
        }
      ]
    }
  },
  {
    "id": "projects",
    "name": "项目工作区",
    "contributes": {
      "pages": [],
      "tabs": [
        "project"
      ],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/vms/:vmId/projects",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/project",
          "methods": [
            "GET",
            "PUT",
            "POST"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/project-runtime",
          "methods": [
            "GET"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/project-directory-migration",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": true
        }
      ]
    }
  },
  {
    "id": "protostate-exchange",
    "name": "协议交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/protostate-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "protostate-generators",
    "name": "有界变体",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/protostate-generators",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "protostate-grammars",
    "name": "消息语法",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/protostate-grammars",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "protostate-guards",
    "name": "条件约束",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/protostate-guards",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "protostate-machines",
    "name": "状态模型",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/protostate-machines",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "protostate-messages",
    "name": "消息材料",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/protostate-messages",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "protostate-properties",
    "name": "性质判断",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/protostate-properties",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "protostate-reductions",
    "name": "失败缩减",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/protostate-reductions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "protostate-reports",
    "name": "协议报告",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/protostate-reports",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "protostate-runs",
    "name": "协议运行",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/protostate-runs",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "protostate-scenarios",
    "name": "对话场景",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/protostate-scenarios",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "protostate-spaces",
    "name": "协议空间",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/protostate-spaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "protostate-targets",
    "name": "目标制品",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/protostate-targets",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "protostate-traces",
    "name": "对话轨迹",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/protostate-traces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "protostate-workbench",
    "name": "协议工作台",
    "contributes": {
      "pages": [
        "protocol-state-lab"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/protostate-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "qualitydesk-baselines",
    "name": "基线窗口",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/qualitydesk-baselines",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "qualitydesk-checklists",
    "name": "接收核对单",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/qualitydesk-checklists",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "qualitydesk-exceptions",
    "name": "限定例外",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/qualitydesk-exceptions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "qualitydesk-exchange",
    "name": "质量交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/qualitydesk-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "qualitydesk-findings",
    "name": "异常处置",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/qualitydesk-findings",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "qualitydesk-partitions",
    "name": "分区与批次",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/qualitydesk-partitions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "qualitydesk-profiles",
    "name": "批次画像",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/qualitydesk-profiles",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "qualitydesk-reconciliation",
    "name": "双侧对账",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/qualitydesk-reconciliation",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "qualitydesk-releases",
    "name": "批次放行",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/qualitydesk-releases",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "qualitydesk-reports",
    "name": "质量档案",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/qualitydesk-reports",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "qualitydesk-rules",
    "name": "门槛版本",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/qualitydesk-rules",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "qualitydesk-runs",
    "name": "批次检查",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/qualitydesk-runs",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "qualitydesk-sources",
    "name": "批次材料",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/qualitydesk-sources",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "qualitydesk-spaces",
    "name": "质量空间",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/qualitydesk-spaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "qualitydesk-workbench",
    "name": "质量工作台",
    "contributes": {
      "pages": [
        "data-quality-studio"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/qualitydesk-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "recipes",
    "name": "环境配方",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/recipes",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/recipe",
          "methods": [
            "GET",
            "PUT",
            "POST"
          ],
          "projectScoped": true
        }
      ]
    }
  },
  {
    "id": "repair",
    "name": "AI 修复会话",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "repair"
      ],
      "http": [
        {
          "path": "/api/vms/:vmId/repair",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": true
        }
      ]
    }
  },
  {
    "id": "replab-channels",
    "name": "传递模型",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/replab-channels",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "replab-clocks",
    "name": "因果时钟",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/replab-clocks",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "replab-conflicts",
    "name": "冲突解释",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/replab-conflicts",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "replab-exchange",
    "name": "同步交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/replab-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "replab-judgments",
    "name": "性质判断",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/replab-judgments",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "replab-operations",
    "name": "操作历史",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/replab-operations",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "replab-policies",
    "name": "合并策略",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/replab-policies",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "replab-replicas",
    "name": "副本定义",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/replab-replicas",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "replab-reports",
    "name": "同步报告",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/replab-reports",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "replab-runs",
    "name": "有限重放",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/replab-runs",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "replab-scenarios",
    "name": "实验编排",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/replab-scenarios",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "replab-schemas",
    "name": "数据模型",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/replab-schemas",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "replab-spaces",
    "name": "副本空间",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/replab-spaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "replab-workbench",
    "name": "同步工作台",
    "contributes": {
      "pages": [
        "replica-sync-lab"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/replab-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "resilience-faults",
    "name": "故障目录",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/resilience-faults",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "resilience-fixtures",
    "name": "演练副本",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/resilience-fixtures",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "resilience-guard",
    "name": "演练监管",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/resilience-guard",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "resilience-probes",
    "name": "业务探针",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/resilience-probes",
          "methods": [
            "GET"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "resilience-recovery",
    "name": "恢复策略",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/resilience-recovery",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "resilience-reports",
    "name": "演练报告",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/resilience-reports",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "resilience-runs",
    "name": "演练运行",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/resilience-runs",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "resilience-scenarios",
    "name": "演练场景",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/resilience-scenarios",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "resilience-targets",
    "name": "演练来源",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/resilience-targets",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "resilience-workbench",
    "name": "可靠性演练",
    "contributes": {
      "pages": [
        "resilience-workbench"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/resilience-workbench",
          "methods": [
            "GET"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "runtimes",
    "name": "运行时版本",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "runtimes"
      ],
      "http": [
        {
          "path": "/api/vms/:vmId/runtimes",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": true
        }
      ]
    }
  },
  {
    "id": "sandbox",
    "name": "沙箱工作台",
    "contributes": {
      "pages": [
        "sandbox"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/sandboxes",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/sandbox",
          "methods": [
            "GET",
            "POST",
            "DELETE"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "schedlab-calendars",
    "name": "日历集合",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/schedlab-calendars",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "schedlab-checks",
    "name": "语义判断",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/schedlab-checks",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "schedlab-clocks",
    "name": "时钟档案",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/schedlab-clocks",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "schedlab-exchange",
    "name": "调度交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/schedlab-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "schedlab-harness",
    "name": "固定调度器",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/schedlab-harness",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "schedlab-observations",
    "name": "触发观察",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/schedlab-observations",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "schedlab-policies",
    "name": "触发策略",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/schedlab-policies",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "schedlab-reports",
    "name": "调度报告",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/schedlab-reports",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "schedlab-rules",
    "name": "周期规则",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/schedlab-rules",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "schedlab-scenarios",
    "name": "场景编排",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/schedlab-scenarios",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "schedlab-simulations",
    "name": "虚拟推进",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/schedlab-simulations",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "schedlab-spaces",
    "name": "调度空间",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/schedlab-spaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "schedlab-workbench",
    "name": "调度工作台",
    "contributes": {
      "pages": [
        "schedule-semantics-lab"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/schedlab-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "schedlab-workloads",
    "name": "工作负载",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/schedlab-workloads",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "secrets",
    "name": "私密配置",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "secrets"
      ],
      "http": [
        {
          "path": "/api/vms/:vmId/secrets",
          "methods": [
            "GET",
            "PUT",
            "DELETE"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/secret-rotation",
          "methods": [
            "GET",
            "PATCH"
          ],
          "projectScoped": true
        }
      ]
    }
  },
  {
    "id": "service-health",
    "name": "服务健康检查",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/vms/:vmId/health",
          "methods": [
            "GET"
          ],
          "projectScoped": true
        }
      ]
    }
  },
  {
    "id": "snapshots",
    "name": "磁盘快照",
    "contributes": {
      "pages": [],
      "tabs": [
        "snapshots"
      ],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/golden-images",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/rescue",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/import",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/signed-bundles",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/snapshots",
          "methods": [
            "POST",
            "PATCH",
            "DELETE"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/snapshot-diff",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/snapshot-merge",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/export",
          "methods": [
            "GET"
          ],
          "projectScoped": false
        },
        {
          "path": "/api/vms/:vmId/clone",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "supply-advisories",
    "name": "公告与匹配",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/supply-advisories",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "supply-exchange",
    "name": "离线交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/supply-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "supply-inventory",
    "name": "依赖清单",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/supply-inventory",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "supply-licenses",
    "name": "许可证声明",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/supply-licenses",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "supply-policies",
    "name": "审查门槛",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/supply-policies",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "supply-provenance",
    "name": "来源与信任",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/supply-provenance",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "supply-reports",
    "name": "审查报告",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/supply-reports",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "supply-reviews",
    "name": "审阅与例外",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/supply-reviews",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "supply-sources",
    "name": "材料与许可",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/supply-sources",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "supply-workbench",
    "name": "供应审查工作台",
    "contributes": {
      "pages": [
        "supply-audit"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/supply-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "sync",
    "name": "目录同步",
    "contributes": {
      "pages": [],
      "tabs": [
        "sync"
      ],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/vms/:vmId/sync",
          "methods": [
            "GET",
            "PUT",
            "POST"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/sync-preview",
          "methods": [
            "POST"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/sync-merge",
          "methods": [
            "POST"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/sync-queue",
          "methods": [
            "POST",
            "DELETE"
          ],
          "projectScoped": true
        },
        {
          "path": "/api/vms/:vmId/sync-rollback",
          "methods": [
            "POST"
          ],
          "projectScoped": true
        }
      ]
    }
  },
  {
    "id": "temporaldesk-alignment",
    "name": "时间对齐",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/temporaldesk-alignment",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "temporaldesk-calendars",
    "name": "日历版本",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/temporaldesk-calendars",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "temporaldesk-comparisons",
    "name": "时间比较",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/temporaldesk-comparisons",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "temporaldesk-exchange",
    "name": "时间交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/temporaldesk-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "temporaldesk-intervals",
    "name": "区间规则",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/temporaldesk-intervals",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "temporaldesk-latepolicy",
    "name": "迟到策略",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/temporaldesk-latepolicy",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "temporaldesk-reports",
    "name": "时间档案",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/temporaldesk-reports",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "temporaldesk-reviews",
    "name": "语义复核",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/temporaldesk-reviews",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "temporaldesk-runs",
    "name": "时间处理",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/temporaldesk-runs",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "temporaldesk-semantics",
    "name": "时间语义",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/temporaldesk-semantics",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "temporaldesk-sources",
    "name": "时间材料",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/temporaldesk-sources",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "temporaldesk-spaces",
    "name": "时间空间",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/temporaldesk-spaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "temporaldesk-windows",
    "name": "窗口定义",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/temporaldesk-windows",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "temporaldesk-workbench",
    "name": "时间工作台",
    "contributes": {
      "pages": [
        "temporal-data-studio"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/temporaldesk-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "terminal-workspace",
    "name": "多终端工作区",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/vms/:vmId/terminal-session",
          "methods": [
            "POST"
          ],
          "projectScoped": true
        }
      ]
    }
  },
  {
    "id": "toolchains",
    "name": "工具安装",
    "contributes": {
      "pages": [],
      "tabs": [
        "development"
      ],
      "developmentSections": [
        "tools"
      ],
      "http": [
        {
          "path": "/api/vms/:vmId/tools",
          "methods": [
            "GET",
            "POST"
          ],
          "projectScoped": true
        }
      ]
    }
  },
  {
    "id": "transfers",
    "name": "传输基础",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/vms/:vmId/download",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "trialplan-allocations",
    "name": "分组设计",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/trialplan-allocations",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "trialplan-analyses",
    "name": "分析计划与结果",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/trialplan-analyses",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "trialplan-assignments",
    "name": "分配版本",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/trialplan-assignments",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "trialplan-exchange",
    "name": "实验资料交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/trialplan-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "trialplan-observations",
    "name": "观测材料",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/trialplan-observations",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "trialplan-outcomes",
    "name": "指标定义",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/trialplan-outcomes",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "trialplan-populations",
    "name": "单位与总体",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/trialplan-populations",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "trialplan-powerplans",
    "name": "规模模拟",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/trialplan-powerplans",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "trialplan-questions",
    "name": "研究问题",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/trialplan-questions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "trialplan-reports",
    "name": "实验规划档案",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/trialplan-reports",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "trialplan-reviews",
    "name": "设计与结果复核",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/trialplan-reviews",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "trialplan-sensitivity",
    "name": "敏感性分析",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/trialplan-sensitivity",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "trialplan-spaces",
    "name": "规划空间",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/trialplan-spaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "trialplan-workbench",
    "name": "实验规划工作台",
    "contributes": {
      "pages": [
        "experiment-planner"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/trialplan-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "virtservice-assertions",
    "name": "场景判断",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/virtservice-assertions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "virtservice-contracts",
    "name": "服务目录",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/virtservice-contracts",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "virtservice-exchange",
    "name": "模拟交接",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/virtservice-exchange",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "virtservice-faults",
    "name": "故障档案",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/virtservice-faults",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "virtservice-matchers",
    "name": "匹配规则",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/virtservice-matchers",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "virtservice-packages",
    "name": "环境版本",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/virtservice-packages",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "virtservice-payloads",
    "name": "响应材料",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/virtservice-payloads",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "virtservice-reports",
    "name": "模拟报告",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/virtservice-reports",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "virtservice-scenarios",
    "name": "消费者场景",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/virtservice-scenarios",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "virtservice-sessions",
    "name": "环境会话",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/virtservice-sessions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "virtservice-spaces",
    "name": "模拟空间",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/virtservice-spaces",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "virtservice-states",
    "name": "服务状态",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/virtservice-states",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "virtservice-traffic",
    "name": "请求证据",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/virtservice-traffic",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "virtservice-transitions",
    "name": "联动规则",
    "contributes": {
      "pages": [],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/virtservice-transitions",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  },
  {
    "id": "virtservice-workbench",
    "name": "模拟工作台",
    "contributes": {
      "pages": [
        "service-virtualization-studio"
      ],
      "tabs": [],
      "developmentSections": [],
      "http": [
        {
          "path": "/api/virtservice-workbench",
          "methods": [
            "POST"
          ],
          "projectScoped": false
        }
      ]
    }
  }
];
