"use client";

import { useMemo, useState } from "react";
import type { DeliverableBlock, ScenarioApp } from "../../lib/fixtures/scenarios";
import { capabilityLabel, capabilityTone, runtimeLabel } from "../../lib/fixtures/scenarios";

type RuntimeProps = {
  scenario: ScenarioApp;
};

export function ScenarioRuntime({ scenario }: RuntimeProps) {
  const [ran, setRan] = useState(false);
  const [loading, setLoading] = useState(false);
  const tone = capabilityTone[scenario.capabilities[0]];
  const samples = useMemo(
    () => Object.fromEntries(scenario.inputs.map((input) => [input.key, input.sample])),
    [scenario.inputs]
  );

  const runScenario = () => {
    setLoading(true);
    window.setTimeout(() => {
      setLoading(false);
      setRan(true);
    }, 520);
  };

  return (
    <div className="run" style={{ ["--rc" as any]: tone.color, ["--rcs" as any]: tone.soft }}>
      <div className="run-head sp-run-head">
        <div className="run-ic">{scenario.name.slice(0, 1)}</div>
        <div>
          <div className="run-name">{scenario.name}</div>
          <p className="run-tag">{scenario.description}</p>
          <div className="sp-chip-row">
            {scenario.capabilities.map((capability) => (
              <span key={capability} className="sp-chip" style={{ ["--chip" as any]: capabilityTone[capability].color, ["--chips" as any]: capabilityTone[capability].soft }}>
                {capabilityLabel[capability]}
              </span>
            ))}
          </div>
        </div>
        <span className="run-cat">{runtimeLabel[scenario.runtime]}</span>
      </div>

      <div className="run-grid">
        <aside className="run-form">
          <div className="run-form-label">输入与知识范围</div>
          {scenario.inputs.map((input) => (
            <div className="run-field" key={input.key}>
              <label>{input.label}</label>
              {input.type === "select" ? (
                <RuntimeChoice options={input.options} defaultValue={input.sample} />
              ) : input.type === "file" ? (
                <div className="sp-file-input">
                  <span>{input.sample}</span>
                  <button>替换</button>
                </div>
              ) : (
                <textarea rows={3} defaultValue={samples[input.key]} placeholder={input.placeholder} />
              )}
            </div>
          ))}

          <div className="sp-knowledge-box">
            <b>已绑定知识源</b>
            {scenario.knowledgeBindings.map((binding) => (
              <span key={binding.id}>
                <i style={{ background: capabilityTone[binding.capability].color }} />
                {binding.name}
              </span>
            ))}
          </div>

          <button className="run-go" onClick={runScenario} disabled={loading}>
            {loading ? "运行中..." : "运行场景"}
          </button>
          <p className="run-hint">输入业务对象后，系统会按场景绑定知识库，输出可保存的业务成品和可信依据。</p>
        </aside>

        <section className="run-out">
          {!ran && !loading && <RuntimePreview scenario={scenario} />}
          {loading && (
            <div className="run-loading">
              <span className="run-spinner" />
              正在检索知识、组织证据并生成成品
            </div>
          )}
          {ran && <RuntimeDeliverable scenario={scenario} />}
        </section>
      </div>
    </div>
  );
}

function RuntimePreview({ scenario }: RuntimeProps) {
  return (
    <div className="sp-runtime-preview">
      <div className="run-empty-ic">{scenario.name.slice(0, 1)}</div>
      <p>准备运行 {runtimeLabel[scenario.runtime]}</p>
      <span>运行后会生成「{scenario.outputTypes.join(" / ")}」，并显示证据、质量信号与下一步动作。</span>
      <div className="sp-preview-grid">
        {scenario.outputTypes.map((type) => (
          <div key={type}>
            <b>{type}</b>
            <span>结构化成品</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RuntimeDeliverable({ scenario }: RuntimeProps) {
  if (scenario.runtime === "questionnaire-grid") return <QuestionnaireRuntime scenario={scenario} />;
  if (scenario.runtime === "document-review") return <DocumentReviewRuntime scenario={scenario} />;
  if (scenario.runtime === "embedded-widget") return <SupportWidgetRuntime scenario={scenario} />;
  if (scenario.runtime === "account-brief" || scenario.runtime === "investigation-brief") return <BriefRuntime scenario={scenario} />;
  if (scenario.runtime === "notebook-report") return <NotebookRuntime scenario={scenario} />;
  return <DefaultRuntime scenario={scenario} />;
}

function BriefRuntime({ scenario }: RuntimeProps) {
  return (
    <div className="run-doc sp-brief-runtime">
      <DeliverableHeader scenario={scenario} />
      <div className="sp-brief-layout">
        <article>
          <h2 className="run-doc-title">{scenario.deliverable.title}</h2>
          <div className="run-doc-body">
            <RenderBlocks blocks={scenario.deliverable.blocks} />
          </div>
        </article>
        <aside className="sp-path-panel">
          <b>关系路径证据</b>
          <PathLine items={scenario.id === "customer-360" ? ["赋范科技", "王皓", "A 项目", "续约合同"] : ["云启网络", "北辰云服", "SLA 违约事件", "替代供应商"]} />
          <span>默认给业务结论，点开风险时再看路径，不把图谱作为主界面。</span>
        </aside>
      </div>
    </div>
  );
}

function DocumentReviewRuntime({ scenario }: RuntimeProps) {
  return (
    <div className="sp-doc-review">
      <div className="sp-doc-paper">
        <div className="sp-doc-line">第 7 条 数据归属与使用</div>
        <p>甲方业务数据归甲方所有，乙方仅在服务履行范围内处理相关数据。</p>
        <div className="sp-doc-line hi">第 9 条 合同到期后自动续约，双方另有约定除外。</div>
        <p>未设置提前通知期，建议加入到期前 30 天书面提醒。</p>
        <div className="sp-doc-line hi">第 12 条 违约金以合同总额 5% 为上限。</div>
      </div>
      <div className="run-doc sp-doc-result">
        <DeliverableHeader scenario={scenario} />
        <h2 className="run-doc-title">{scenario.deliverable.title}</h2>
        <div className="run-doc-body">
          <RenderBlocks blocks={scenario.deliverable.blocks} />
        </div>
      </div>
    </div>
  );
}

function QuestionnaireRuntime({ scenario }: RuntimeProps) {
  const rows = [
    { q: "是否支持 SSO？", answer: "支持 SAML 2.0 与 OIDC，可与企业 IdP 集成。", source: "身份认证白皮书", status: "已批准" },
    { q: "静态数据如何加密？", answer: "静态数据使用 AES-256，传输层使用 TLS 1.2+。", source: "安全白皮书 v4", status: "已批准" },
    { q: "供应商审计周期？", answer: "建议由安全 SME 补充最新审计周期。", source: "待补充", status: "需审核" },
    { q: "是否支持数据删除请求？", answer: "支持租户级数据删除请求，需管理员发起。", source: "DPA 附件", status: "已生成" }
  ];
  return (
    <div className="sp-q">
      <DeliverableHeader scenario={scenario} />
      <div className="sp-q-top">
        <h2>{scenario.deliverable.title}</h2>
        <span>42/48 已生成 · 6 个需审核</span>
      </div>
      <div className="sp-q-table">
        {rows.map((row) => (
          <div className="sp-q-row" key={row.q}>
            <b>{row.q}</b>
            <p>{row.answer}</p>
            <span>{row.source}</span>
            <em className={row.status === "需审核" ? "warn" : ""}>{row.status}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function NotebookRuntime({ scenario }: RuntimeProps) {
  return (
    <div className="run-doc sp-notebook">
      <DeliverableHeader scenario={scenario} />
      <div className="sp-notebook-layout">
        <aside>
          <b>手册大纲</b>
          <span>01 认识产品与客户</span>
          <span>02 使用场景工具</span>
          <span>03 完成客户复盘</span>
          <b>来源</b>
          <span>销售 onboarding</span>
          <span>客户简报模板</span>
        </aside>
        <article>
          <h2 className="run-doc-title">{scenario.deliverable.title}</h2>
          <div className="run-doc-body">
            <RenderBlocks blocks={scenario.deliverable.blocks} />
          </div>
        </article>
      </div>
    </div>
  );
}

function SupportWidgetRuntime({ scenario }: RuntimeProps) {
  return (
    <div className="sp-widget-runtime">
      <div className="sp-shop-page">
        <div className="sp-shop-bar" />
        <div className="sp-shop-card" />
        <div className="sp-shop-card wide" />
        <div className="sp-chat-widget">
          <b>在线助手</b>
          <p>订单 8842 为什么延迟？</p>
          <span>订单因华东仓盘点延迟 1 天。可为客户提供运费券补偿。</span>
        </div>
      </div>
      <div className="run-doc">
        <DeliverableHeader scenario={scenario} />
        <h2 className="run-doc-title">{scenario.deliverable.title}</h2>
        <div className="run-doc-body">
          <RenderBlocks blocks={scenario.deliverable.blocks} />
        </div>
      </div>
    </div>
  );
}

function DefaultRuntime({ scenario }: RuntimeProps) {
  return (
    <div className="run-doc">
      <DeliverableHeader scenario={scenario} />
      <h2 className="run-doc-title">{scenario.deliverable.title}</h2>
      <div className="run-doc-body">
        <RenderBlocks blocks={scenario.deliverable.blocks} />
      </div>
    </div>
  );
}

function DeliverableHeader({ scenario }: RuntimeProps) {
  return (
    <div className="run-doc-bar">
      <span className="run-doc-kind">{scenario.deliverable.kind}</span>
      <div className="run-doc-actions">
        {scenario.actions.slice(0, 3).map((action) => (
          <button key={action}>{action}</button>
        ))}
      </div>
    </div>
  );
}

export function RenderBlocks({ blocks }: { blocks: DeliverableBlock[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === "lead") return <p className="bk-lead" key={index}>{block.text}</p>;
        if (block.type === "section") {
          return (
            <section className="bk-section" key={index}>
              <h3>{block.heading}</h3>
              <p>{block.body}</p>
            </section>
          );
        }
        if (block.type === "bullets") {
          return (
            <section className="bk-section" key={index}>
              <h3>{block.heading}</h3>
              <ul className="bk-bullets">
                {block.items.map((item) => (
                  <li key={item.text}>
                    <span>{item.text}</span>
                    {item.cite && <em className="bk-cite">{item.cite}</em>}
                  </li>
                ))}
              </ul>
            </section>
          );
        }
        if (block.type === "risk") {
          return (
            <section className="bk-section" key={index}>
              <h3>{block.heading}</h3>
              <div className="bk-risks">
                {block.items.map((item) => (
                  <div className={`bk-risk lv-${item.level}`} key={item.title}>
                    <span className="bk-risk-lv">{item.level === "high" ? "高" : item.level === "mid" ? "中" : "低"}</span>
                    <div>
                      <b>{item.title}</b>
                      <p>{item.note}</p>
                      <em className="bk-cite">{item.cite}</em>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        }
        return (
          <div className="bk-sources" key={index}>
            <span className="bk-sources-label">来源依据</span>
            {block.items.map((item) => (
              <div className="bk-src" key={item.title}>
                <SourceIcon />
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.meta}</span>
                </div>
                <span className="bk-src-open">查看</span>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

function RuntimeChoice({ options, defaultValue }: { options: string[]; defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="run-choice-group" role="radiogroup" aria-label="选择业务选项">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={value === option ? "active" : ""}
          role="radio"
          aria-checked={value === option}
          onClick={() => setValue(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function PathLine({ items }: { items: string[] }) {
  return (
    <div className="sp-path-line">
      {items.map((item, index) => (
        <span key={item}>
          {item}
          {index < items.length - 1 && <i />}
        </span>
      ))}
    </div>
  );
}

function SourceIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}
