// 国旗（flag-icons，MIT）。每面旗是单独的 SVG 资源，只在用到时加载。

const FLAGS = import.meta.glob('/node_modules/flag-icons/flags/4x3/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/** 存在主权争议、显示旗帜容易引起歧义的地区不显示旗帜。 */
const SKIP = new Set(['TW']);

export default function Flag({ iso2, title }: { iso2: string | null | undefined; title?: string }) {
  if (!iso2 || !/^[A-Z]{2}$/.test(iso2) || SKIP.has(iso2)) return null;
  const url = FLAGS[`/node_modules/flag-icons/flags/4x3/${iso2.toLowerCase()}.svg`];
  if (!url) return null;
  return <img className="flag" src={url} alt="" title={title} width={20} height={15} loading="lazy" />;
}
