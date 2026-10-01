export type TemplateLibraryView = "featured" | "grid" | "list" | "compare";

export type TemplateViewOption = {
  id: TemplateLibraryView;
  label: string;
  description: string;
};

export const templateViewOptions: TemplateViewOption[] = [
  {
    id: "featured",
    label: "精选",
    description: "突出推荐方案、适用场景和创建路径，适合第一次选择模板。"
  },
  {
    id: "grid",
    label: "网格",
    description: "以方案卡片快速浏览全部模板，适合比较业务主题和输入资料。"
  },
  {
    id: "list",
    label: "列表",
    description: "用更高信息密度查看分类、耗时、资料类型和产出。"
  },
  {
    id: "compare",
    label: "对比",
    description: "横向对比适用业务、支持资料、产出和复核要求。"
  }
];

export function getTemplateViewOption(value: string | null | undefined): TemplateViewOption {
  return templateViewOptions.find((option) => option.id === value) ?? templateViewOptions[0];
}
