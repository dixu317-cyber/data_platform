import Link from "next/link";
import { SiteHeader } from "../components/site/site-header";
import { SiteFooter } from "../components/site/site-footer";
import { HeroAnswer } from "../components/site/hero-answer";
import { PainGuide } from "../components/site/pain-guide";
import { ScenarioRows } from "../components/site/scenario-rows";
import { Reveal } from "../components/site/reveal";

const flow = [
  { n: 1, t: "选 Agent", d: "管理员按业务痛点，选对一个 Agent 方案" },
  { n: 2, t: "配置", d: "接入数据与工具，系统装配成能用的 Agent" },
  { n: 3, t: "上线", d: "把 Agent 挂成一个对外的业务场景" },
  { n: 4, t: "使用", d: "员工只管问，得到带依据的答案" }
];

const principles = [
  {
    k: "01",
    t: "一个入口，问遍所有 Agent",
    d: "员工不必判断该找哪个 Agent。提出问题，系统自动调度最合适的 Agent，复杂的部分留在后台。"
  },
  {
    k: "02",
    t: "每个答案，都带得出处",
    d: "答案附上可打开的来源——原文段落、关系链或知识条目。结论站得住，随时查得到。"
  },
  {
    k: "03",
    t: "前台后台，各司其职",
    d: "前台只为业务消费而生，干净好用；后台承载 Agent 的搭建与运行，管得清、调得动。"
  }
];

export default function Home() {
  return (
    <>
      <SiteHeader />

      {/* HERO */}
      <section className="hero">
        <div className="hero-glow hero-glow-1" aria-hidden />
        <div className="hero-glow hero-glow-2" aria-hidden />
        <div className="wrap wrap-wide hero-grid">
          <div className="hero-left">
            <span className="eyebrow rise" style={{ animationDelay: "0ms" }}>
              企业 Agent 中台
            </span>
            <h1 className="display hero-title rise" style={{ animationDelay: "80ms" }}>
              让企业 Agent
              <br />
              <span className="hero-accent">可问 · 可信 · 可管</span>
            </h1>
            <p className="hero-sub rise" style={{ animationDelay: "180ms" }}>
              把散落在文档、对话和业务系统里的能力，按场景装配成 Agent。员工在一个入口提问，
              拿到带依据的答案；管理员看得见 Agent 怎么建、怎么调、怎么运行——
              <strong>技术藏在背后，留给业务的是确定的结果。</strong>
            </p>
            <div className="hero-cta rise" style={{ animationDelay: "280ms" }}>
              <a href="#guide" className="btn btn-primary btn-lg">
                按你的场景选方案
              </a>
              <Link href="/app" className="btn btn-ghost btn-lg">
                进入 Agent 工作台
              </Link>
            </div>
            <div className="hero-trust rise" style={{ animationDelay: "380ms" }}>
              <div>
                <strong>3</strong>
                <span>
                  种 Agent 方案
                  <br />
                  覆盖企业主流场景
                </span>
              </div>
              <div className="hero-trust-sep" />
              <div>
                <strong>1</strong>
                <span>
                  个统一提问入口
                  <br />
                  跨 Agent 自动调度
                </span>
              </div>
              <div className="hero-trust-sep" />
              <div>
                <strong>100%</strong>
                <span>
                  答案带来源依据
                  <br />
                  可打开核对
                </span>
              </div>
            </div>
          </div>
          <div className="hero-right rise" style={{ animationDelay: "320ms" }}>
            <HeroAnswer />
          </div>
        </div>
      </section>

      {/* SCENARIOS */}
      <section className="section section-alt" id="scenarios">
        <div className="wrap wrap-wide">
          <Reveal>
            <span className="eyebrow">三大方案</span>
            <h2 className="display section-title">不同场景，用最合适的 Agent</h2>
            <p className="section-lead">
              每个方案解决一类真实问题，使用方式也各不相同——该搜的搜、该读的读、该看关系的看关系，
              不是三个一样的聊天框。
            </p>
          </Reveal>
          <ScenarioRows />
        </div>
      </section>

      {/* PAIN GUIDE */}
      <section className="section" id="guide">
        <div className="wrap wrap-wide">
          <Reveal>
            <span className="eyebrow">场景推荐</span>
            <h2 className="display section-title">你想用 Agent 解决什么？</h2>
            <p className="section-lead">
              选一个最接近的场景，或直接描述你的痛点——产品会推荐方案、说明为什么，并带你去配置 Agent。
            </p>
          </Reveal>
          <Reveal delay={120}>
            <PainGuide />
          </Reveal>
        </div>
      </section>

      {/* HOW IT WORKS — timeline */}
      <section className="section section-alt">
        <div className="wrap wrap-wide">
          <Reveal>
            <span className="eyebrow">怎么用</span>
            <h2 className="display section-title">
              四步，从一堆资料到一个能干的 Agent
            </h2>
            <p className="section-lead">
              管理员把 Agent 建起来、挂上线，员工就能直接提问——一条清晰的路径。
            </p>
          </Reveal>
          <Reveal as="div" className="flow">
            <div className="flow-track">
              {flow.map((s) => (
                <div className="flow-step" key={s.n} style={{ ["--fd" as any]: `${s.n * 0.12}s` }}>
                  <span className="flow-num display">{s.n}</span>
                  <h3>{s.t}</h3>
                  <p>{s.d}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* STAGES: application workspace / operations console */}
      <section className="section" id="stages">
        <div className="wrap wrap-wide">
          <Reveal>
            <span className="eyebrow">产品架构</span>
            <h2 className="display section-title">业务应用在前，Agent 运营在后</h2>
            <p className="section-lead">
              面向员工的是 Agent 工作台，面向管理员的是 Agent 运营后台。两端服务不同角色，但共享同一套权限、资料和 Agent 配置链路。
            </p>
          </Reveal>
          <div className="stage-grid">
            <Reveal className="stage-card stage-front">
              <div className="stage-tag">前台 · 员工消费</div>
              <h3 className="display">一处提问，处处有据</h3>
              <p>员工带着问题进来，一个入口问遍所有 Agent，答案直接给结论并附可打开的来源；也能像翻百科一样浏览沉淀的知识，在任意条目上追问。导航只有三项：问公司大脑 / 浏览知识 / 我的——没有引擎名、没有参数、没有技术面板。</p>
              <div className="stage-mock stage-mock-front">
                <div className="sm-bar">
                  <span>问公司大脑</span>
                  <span>浏览知识</span>
                  <span>我的</span>
                </div>
                <div className="sm-ask">
                  问点什么…<span className="sm-go">问</span>
                </div>
                <div className="sm-ans">
                  <p>答案直接给结论，并附「依据 3 条」可逐条打开。</p>
                  <div className="sm-cite">▸ 《差旅制度 v3》第 4 条 · 打开原文</div>
                </div>
              </div>
              <Link href="/app" className="btn btn-soft">
                进入 Agent 工作台 →
              </Link>
            </Reveal>

            <Reveal delay={120} className="stage-card stage-back">
              <div className="stage-tag stage-tag-back">后台 · Agent 管理</div>
              <h3 className="display">真业务链路，密度清晰</h3>
              <p>按域分区管理，建 Agent 是一条看得见的线性管道；参数封成业务档位，不暴露裸参数。</p>
              <div className="stage-mock stage-mock-back">
                <div className="sm-steps">
                  <span className="on">① 资料</span>
                  <span>② 整理预览</span>
                  <span>③ 设置</span>
                  <span>④ 试问</span>
                </div>
                <div className="sm-files">
                  <div>
                    <i className="d-ok" />
                    客户名单.xlsx<em>已就绪</em>
                  </div>
                  <div>
                    <i className="d-run" />
                    拜访纪要.docx<em>处理中</em>
                  </div>
                  <div>
                    <i className="d-wait" />
                    合同2024.pdf<em>待处理</em>
                  </div>
                </div>
                <div className="sm-knobs">
                  <span>取证范围　聚焦 ●———— 全面</span>
                  <span>匹配严格度　松 ——●— 严</span>
                </div>
              </div>
              <Link href="/admin" className="btn btn-soft">
                进入 Agent 运营后台 →
              </Link>
            </Reveal>
          </div>
        </div>
      </section>

      {/* APPROACH / RESEARCH */}
      <section className="section section-alt" id="approach">
        <div className="wrap wrap-wide">
          <Reveal>
            <span className="eyebrow">产品原则</span>
            <h2 className="display section-title">把复杂留给系统，把确定留给业务</h2>
            <p className="section-lead">
              贯穿前台与后台的三条原则，让企业 Agent 真正可问、可信、可管。
            </p>
          </Reveal>
          <div className="appr-grid">
            {principles.map((p, i) => (
              <Reveal key={p.k} delay={i * 100} className="appr-card card card-pad">
                <span className="appr-k mono">{p.k}</span>
                <h3>{p.t}</h3>
                <p>{p.d}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="section cta-section">
        <div className="hero-glow cta-glow" aria-hidden />
        <div className="wrap wrap-wide cta-inner">
          <Reveal>
            <h2 className="display cta-title">
              <span>把公司能力沉淀为</span>
              <span>可追问、可溯源、可运营的 Agent</span>
            </h2>
            <p className="cta-sub">
              从业务提问进入 Agent 工作台，由 Agent 运营后台完成资料接收、权限复核、装配配置和 Agent 治理。
            </p>
            <div className="cta-actions">
              <Link href="/app" className="btn btn-primary btn-lg">
                进入 Agent 工作台
              </Link>
              <Link href="/admin" className="btn btn-ghost btn-lg">
                进入 Agent 运营后台
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      <SiteFooter />
    </>
  );
}
