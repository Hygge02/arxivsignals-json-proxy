const UA = 'Mozilla/5.0 (compatible; ArxivSignalsJSONProxy/1.0)';

function clean(s='') {
  return s.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();
}

function parseCards(html) {
  const starts = [...html.matchAll(/<article[^>]*class=["'][^"']*preview-card[^"']*["'][^>]*>/gi)].map(m=>m.index);
  const papers=[];
  for (let i=0;i<starts.length;i++) {
    const chunk=html.slice(starts[i], starts[i+1] ?? html.length);
    const id=clean((chunk.match(/preview-paper-id[^>]*>([^<]+)/i)||[])[1]||'');
    const title=clean((chunk.match(/preview-title[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)||[])[1]||'');
    const summary=clean((chunk.match(/preview-summary-(?:gemini|one-liner)[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i)||[])[1]||'');
    if (id && title) papers.push({paper_id:id,title,summary});
  }
  return papers;
}

function meta(html,papers) {
  const text=clean(html);
  const totalMatch=text.match(/([\d,]+)\s+(?:matches|papers|results)/i);
  const total=totalMatch ? Number(totalMatch[1].replace(/,/g,'')) : null;
  const pageSize=papers.length || null;
  const pages=total && pageSize ? Math.ceil(total/pageSize) : null;
  return {total,pages,page_size:pageSize};
}

export default async function handler(req,res) {
  const date=String(req.query.date||'');
  const page=Math.max(1,Number(req.query.page||1));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({error:'date must be YYYY-MM-DD'});
  const base='https://arxivsignals.io/explore';
  const url=`${base}?date=${encodeURIComponent(date)}&page=${page}`;
  try {
    let r=await fetch(url,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml','cache-control':'no-cache'}});
    let html=await r.text();
    let papers=parseCards(html);
    let mode='html';
    if (!r.ok || papers.length===0) {
      const rr=await fetch(`${url}&_rsc=1`,{headers:{'user-agent':UA,'accept':'*/*','RSC':'1','cache-control':'no-cache'}});
      const body=await rr.text();
      const rp=parseCards(body);
      if (rr.ok && rp.length) { r=rr; html=body; papers=rp; mode='rsc'; }
    }
    const m=meta(html,papers);
    const unique=new Set(papers.map(p=>p.paper_id)).size;
    const nonempty=papers.filter(p=>p.summary).length;
    res.setHeader('Cache-Control','s-maxage=60, stale-while-revalidate=300');
    return res.status(r.ok?200:r.status).json({date,page,source:url,mode,http_status:r.status,...m,card_count:papers.length,unique_paper_id_count:unique,nonempty_summary_count:nonempty,papers});
  } catch (e) {
    return res.status(502).json({error:'upstream_fetch_failed',message:String(e?.message||e)});
  }
}
