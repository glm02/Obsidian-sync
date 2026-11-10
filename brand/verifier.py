"""Vérifications de la livraison, sorties et profil de navigateur dans brand/."""
from pathlib import Path
import json
import os
import xml.etree.ElementTree as ET
from collections import deque
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'verification'
TMP = ROOT / '.tmp'
OUT.mkdir(exist_ok=True)
TMP.mkdir(exist_ok=True)
os.environ['TEMP'] = str(TMP)
os.environ['TMP'] = str(TMP)

MASTERS = ['cordee-marque.svg', 'cordee-logo.svg', 'cordee-logo-clair.svg',
           'cordee-monochrome.svg', 'favicon.svg']
NS = '{http://www.w3.org/2000/svg}'
results = {}
for name in MASTERS:
    tree = ET.parse(ROOT / name)
    tags = [node.tag.removeprefix(NS) for node in tree.iter()]
    banned = set(tags) & {'text', 'image', 'filter', 'mask', 'clipPath',
                         'linearGradient', 'radialGradient', 'style', 'use'}
    assert not banned, (name, banned)
    assert tree.getroot().get('viewBox')
    assert tree.find(f'{NS}title') is not None
    assert all('stroke' not in node.attrib for node in tree.iter())
    assert all(not any(k.endswith('href') for k in node.attrib) for node in tree.iter())
    results[name] = {'vectoriel_autonome': True, 'viewBox': tree.getroot().get('viewBox'),
                     'nombre_traces': tags.count('path')}


def holes(image):
    """Composantes sombres fermées dans le vrai raster, seuil de luminance 120."""
    image = image.convert('RGBA')
    w,h = image.size
    pixels = image.load()
    remaining = {(x,y) for x in range(w) for y in range(h)
                 if pixels[x,y][3] < 128 or sum(pixels[x,y][:3])/3 < 120}
    closed = []
    while remaining:
        start=remaining.pop()
        queue=deque([start])
        component=[start]
        edge=False
        while queue:
            x,y=queue.popleft()
            edge |= x in (0,w-1) or y in (0,h-1)
            for point in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
                if point in remaining:
                    remaining.remove(point)
                    queue.append(point)
                    component.append(point)
        if not edge:
            closed.append(len(component))
    return sorted(closed)


for name,size in [('icone-512.png',512),('favicon-32.png',32),('favicon-16.png',16)]:
    im=Image.open(ROOT/name).convert('RGBA')
    assert im.size == (size,size), (name,im.size)
    # Chrome conserve parfois un alpha de 1/255 au coin du rendu 16 px.
    assert im.getpixel((0,0))[3] <= 1, name
    assert im.getpixel((size//2,size//2)) == (22,22,22,255), name
    # À 512 px, inutile de segmenter : le test porte sur les petits fichiers livrés.
    closed = holes(im) if size <= 32 else None
    if closed is not None:
        assert len(closed) == 2, (name,closed)
    results[name] = {'dimensions':[size,size], 'alpha_coin':im.getpixel((0,0))[3],
                     'fond_central':'#161616', 'oeillets_fermes_pixels':closed}

# Inspection agrandie, obtenue par duplication des pixels, sans redessin du logo.
sheet=Image.new('RGB',(960,420),'#252525')
draw=ImageDraw.Draw(sheet)
for x,size in [(40,16),(410,32)]:
    im=Image.open(ROOT/f'favicon-{size}.png').convert('RGBA')
    large=im.resize((size*10,size*10),Image.Resampling.NEAREST)
    sheet.paste(large,(x,55),large)
    draw.text((x,24),f'PNG {size} px - agrandissement x10',fill='#f9fbff')
sheet.save(OUT/'pixels.png')

chrome = Path(os.environ.get('PROGRAMFILES', 'C:/Program Files'))/'Google/Chrome/Application/chrome.exe'
assert chrome.exists(), 'Chrome local introuvable'
browser_errors=[]
requests=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=str(chrome),headless=True,
                              args=['--disable-extensions','--no-first-run'])
    page=browser.new_page(viewport={'width':1440,'height':1000},device_scale_factor=1)
    page.on('pageerror', lambda error: browser_errors.append(str(error)))
    page.on('request',lambda request: requests.append(request.url))
    page.goto((ROOT/'apercu.html').as_uri(),wait_until='networkidle')
    page.evaluate('document.fonts.ready')
    assert page.locator('img').evaluate_all('(images)=>images.every(i=>i.complete&&i.naturalWidth>0)')
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    page.screenshot(path=str(OUT/'apercu-bureau.png'),full_page=True)
    # Figer aussi un cadrage compact pour l'inspection visuelle des deux couleurs.
    page.locator('.grid').screenshot(path=str(OUT/'tests-fonds-tailles.png'))
    assert page.locator('.size').evaluate_all('''items => items.every(item => {
      const n=parseInt(item.innerText); const el=item.querySelector('img,div');
      const r=el.getBoundingClientRect(); return r.width===n && r.height===n;
    })''')
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
    page.screenshot(path=str(OUT/'apercu-mobile.png'),full_page=True)
    assert not browser_errors, browser_errors
    assert all(url.startswith(('file:','data:')) for url in requests), requests
    results['navigateur']={'moteur':browser.version,'bureau':[1440,1000],
                           'mobile':[390,844], 'images_chargees':True,
                           'tailles_css_exactes':True,'debordement_horizontal':False,
                           'erreurs_page':browser_errors,'requetes_reseau':0}
    browser.close()

(OUT/'controles.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(results,ensure_ascii=False,indent=2))
