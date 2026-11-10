"""Construction originale Cordée ; ne produit que des fichiers dans brand/."""
from pathlib import Path
from math import acos, cos, sin, pi

ROOT = Path(__file__).resolve().parent
BLUE, DARK, WHITE = '#4124fb', '#161616', '#f9fbff'


def svg(body, title, vb='0 0 256 256', color='#111111'):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" '
            f'fill="{color}" role="img" aria-labelledby="titre">\n'
            f'  <title id="titre">{title}</title>\n{body}\n</svg>\n')


def write(name, content):
    (ROOT / name).write_text(content, encoding='utf-8')


def xy(x, y):
    return f'{x:.2f} {y:.2f}'


def attache(R=104, r=68, d=86, tip=32, hole=12, cx=116, cy=128):
    """Union analytique d'un arc en C et de deux œillets, sans masque."""
    phi = pi/4
    ao = phi + acos((R*R+d*d-tip*tip)/(2*R*d))
    ai = phi + acos((r*r+d*d-tip*tip)/(2*r*d))
    pt = lambda rad, angle: xy(cx+rad*cos(angle), cy+rad*sin(angle))
    path = (f'M{pt(R,-ao)} A{R} {R} 0 1 0 {pt(R,ao)} '
            f'A{tip} {tip} 0 1 0 {pt(r,ai)} '
            f'A{r} {r} 0 1 1 {pt(r,-ai)} '
            f'A{tip} {tip} 0 1 0 {pt(R,-ao)} Z')
    for angle in [-phi, phi]:
        x,y=cx+d*cos(angle),cy+d*sin(angle)
        path += (f' M{xy(x+hole,y)} A{hole} {hole} 0 1 0 {xy(x-hole,y)} '
                 f'A{hole} {hole} 0 1 0 {xy(x+hole,y)} Z')
    return f'  <path fill-rule="evenodd" d="{path}"/>'


write('explorations/a-attache-v1.svg', svg(attache(), 'A — Le C d’attache'))
write('explorations/b-fil-v1.svg', svg('''  <path d="M64 56 H164 A44 44 0 0 1 164 144 H92 A36 36 0 0 0 92 216 H192" fill="none" stroke="#111111" stroke-width="30" stroke-linecap="round"/>
  <circle cx="64" cy="56" r="22"/><circle cx="128" cy="144" r="22"/><circle cx="192" cy="216" r="22"/>''', 'B — Le fil commun'))
write('explorations/c-replis-v1.svg', svg('''  <path d="M112 40 H80 A40 40 0 0 0 40 80 V128 A40 40 0 0 0 80 168 H144 A40 40 0 0 0 184 128 V80 A40 40 0 0 0 144 40 Z M112 72 H144 A8 8 0 0 1 152 80 V128 A8 8 0 0 1 144 136 H80 A8 8 0 0 1 72 128 V80 A8 8 0 0 1 80 72 Z" fill-rule="evenodd"/>
  <path d="M112 88 H176 A40 40 0 0 1 216 128 V176 A40 40 0 0 1 176 216 H112 A40 40 0 0 1 72 176 V160 H104 V176 A8 8 0 0 0 112 184 H176 A8 8 0 0 0 184 176 V128 A8 8 0 0 0 176 120 H112 Z"/>''', 'C — Les deux replis'))

# Deuxième passage : centrage optique et ouvertures agrandies de 12 à 14 unités.
MARK = attache(cx=138, hole=14)
write('explorations/a-attache-v2.svg', svg(MARK, 'A — Le C d’attache, affiné'))

# Alphabet original dessiné ici, sans police, sans conversion d'une fonte tierce.
GLYPHS = {
    'C': 'M112 23 L96 39 C87 27 75 20 60 20 C35 20 22 40 22 72 C22 104 35 124 60 124 C75 124 87 117 96 105 L112 121 C99 137 82 146 60 146 C22 146 0 118 0 72 C0 26 22 -2 60 -2 C82 -2 99 7 112 23 Z',
    'o': 'M52 36 C85 36 104 57 104 91 C104 125 85 146 52 146 C19 146 0 125 0 91 C0 57 19 36 52 36 Z M52 56 C32 56 22 69 22 91 C22 113 32 126 52 126 C72 126 82 113 82 91 C82 69 72 56 52 56 Z',
    'r': 'M0 38 H21 V54 C30 41 42 36 59 36 H72 V58 H58 C36 58 22 71 22 92 V144 H0 Z',
    'd': 'M86 -8 H108 V144 H87 V130 C78 141 66 146 50 146 C19 146 0 125 0 91 C0 57 19 36 50 36 C65 36 77 41 86 51 Z M52 56 C32 56 22 69 22 91 C22 113 32 126 52 126 C72 126 86 113 86 91 C86 69 72 56 52 56 Z',
    'e': 'M104 88 V100 H22 C25 117 36 127 54 127 C69 127 80 122 89 113 L102 127 C90 140 75 146 53 146 C19 146 0 125 0 91 C0 58 20 36 52 36 C84 36 104 57 104 88 Z M23 82 H82 C79 65 68 55 52 55 C35 55 25 65 23 82 Z',
}


def lettering(color):
    parts = [f'  <g id="mot" fill="{color}" fill-rule="evenodd">']
    for char,x in [('C',300),('o',430),('r',552),('d',636),('e',762),('e',882)]:
        parts.append(f'    <path transform="translate({x} 58)" d="{GLYPHS[char]}"/>')
    parts.append('    <path d="M802 80 L828 54 H854 L828 80 Z"/>')
    parts.append('  </g>')
    return '\n'.join(parts)


def lockup(symbol_color, type_color, title):
    return svg(f'  <g id="symbole" fill="{symbol_color}">\n{MARK}\n  </g>\n'
               + lettering(type_color), title, '0 0 1016 256', type_color)


write('cordee-marque.svg', svg(MARK, 'Cordée — symbole', color=BLUE))
write('cordee-logo.svg', lockup(BLUE, WHITE, 'Cordée — logo pour fond sombre'))
write('cordee-logo-clair.svg', lockup(BLUE, DARK, 'Cordée — logo pour fond clair'))
write('cordee-monochrome.svg', lockup('currentColor', 'currentColor', 'Cordée — logo monochrome'))
# Les petites icônes emploient le blanc : meilleure séparation sur le fond sombre.
ICON = (f'  <rect width="256" height="256" rx="56" fill="{DARK}"/>\n'
        f'  <g fill="{WHITE}" transform="translate(20.48 20.48) scale(0.84)">\n{MARK}\n  </g>')
write('favicon.svg', svg(ICON, 'Cordée — icône', color=WHITE))


def inline(body, title, name, vb='0 0 256 256'):
    return svg(body, title, vb, 'currentColor').replace('titre', f'titre-{name}')


def preview_lockup(suffix):
    markup=lockup('currentColor', 'currentColor', 'Cordée')
    return (markup.replace('titre', f'titre-{suffix}')
            .replace('id="symbole"', f'id="symbole-{suffix}"')
            .replace('id="mot"', f'id="mot-{suffix}"'))


mono = preview_lockup('mono')
reverse = preview_lockup('inverse')
ladder_dark = ''.join(
    f'<div class="size"><div style="width:{n}px;height:{n}px">'
    + inline(MARK, f'Cordée, {n} pixels', f'sombre-{n}')
    + f'</div><span>{n} px</span></div>' for n in [16,24,32,48,64])
ladder_light = ''.join(
    f'<div class="size"><img src="cordee-marque.svg" width="{n}" height="{n}" alt="Cordée, {n} pixels">'
    + f'<span>{n} px</span></div>' for n in [16,24,32,48,64])
pixel_cards = ''.join(
    f'<div class="pixel"><img src="favicon-{n}.png" width="{n*8}" height="{n*8}" '
    f'alt="Favicon {n} pixels, agrandi huit fois"><span>{n} px × 8, pixels réels</span></div>'
    for n in [16,32])
write('apercu.html', '''<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cordée — planche de marque</title><link rel="icon" type="image/svg+xml" href="favicon.svg">
<style>
:root{color-scheme:dark;--bg:#161616;--ink:#f9fbff;--blue:#4124fb;--line:#353535}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1280px;margin:auto;padding:48px 36px 64px}header{display:flex;justify-content:space-between;align-items:center;gap:24px;margin-bottom:36px}
.eyebrow{margin:0;text-transform:uppercase;font-size:11px;letter-spacing:.15em;color:#bbb}header a{color:inherit;text-decoration:none;border-bottom:1px solid #777;font-size:13px}
h1{font-size:clamp(30px,4vw,52px);line-height:1.12;font-weight:550;letter-spacing:-.04em;max-width:720px;margin:16px 0 36px}
.hero{min-height:250px;padding:48px 36px;display:flex;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:18px;margin-bottom:16px}
.hero img{width:min(100%,660px);height:auto;display:block}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.card{padding:26px;border:1px solid var(--line);border-radius:18px;min-width:0;overflow:hidden}.light{background:#f9fbff;color:#161616;border-color:#f9fbff}
.card h2{font-size:12px;font-weight:550;text-transform:uppercase;letter-spacing:.12em;margin:0 0 24px}.card p,.meta{font-size:12px;line-height:1.65;color:#aaa;margin:14px 0 0}.light p{color:#666}
.lockup{height:150px;display:flex;align-items:center;justify-content:center}.lockup img,.lockup svg{display:block;width:100%;height:auto;max-width:440px}
.blue{background:var(--blue);border-color:var(--blue);color:#f9fbff}.blue p{color:#f9fbff}.sizes{display:flex;align-items:flex-start;justify-content:space-around;gap:12px;min-height:116px;padding-top:18px}
.size{display:flex;flex-direction:column;align-items:center;gap:14px;min-width:32px}.size>div{flex:none}.size svg{display:block;width:100%;height:100%}.size span{font-size:11px;color:inherit;opacity:.7}
.icon-row{display:flex;align-items:center;gap:28px;min-height:168px;flex-wrap:wrap}.app{width:136px;height:136px;display:block;border:1px solid #3d3d3d;border-radius:30px}
.tab{display:flex;align-items:center;gap:10px;background:#292929;border:1px solid #444;border-radius:10px 10px 0 0;padding:15px 18px;font-size:12px}.tab img{display:block;flex:none}
.favicons{display:flex;align-items:center;gap:22px;min-height:46px}.caption{font-size:11px;color:#bbb}.pixel-row{display:flex;align-items:flex-start;gap:28px;flex-wrap:wrap;min-height:302px}
.pixel{display:flex;align-items:flex-start;flex-direction:column;gap:12px}.pixel img{display:block;image-rendering:pixelated;background:repeating-conic-gradient(#303030 0 25%,#252525 0 50%) 0/16px 16px}.pixel span{font-size:11px;color:#bbb}
.concepts{margin-top:32px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.concept{padding:22px;border:1px solid var(--line);border-radius:14px}.concept.chosen{border-color:var(--blue)}
.concept .thumb{height:116px;display:flex;justify-content:center;align-items:center;background:#f9fbff;border-radius:8px;margin-bottom:16px}.thumb img{width:90px;height:90px}
.concept h3{font-size:14px;font-weight:550;margin:0 0 8px}.concept p{font-size:12px;line-height:1.7;color:#bbb;margin:0}.chosen h3{color:var(--ink)}
footer{display:flex;justify-content:space-between;gap:24px;margin-top:30px;border-top:1px solid var(--line);padding-top:22px;font-size:11px;color:#aaa}footer a{color:inherit}
@media(max-width:700px){main{padding:28px 18px}.grid,.concepts{grid-template-columns:1fr}.hero{padding:30px 14px;min-height:160px}.card{padding:22px}.lockup{height:120px}.pixel-row{gap:18px}footer{flex-direction:column}}
</style></head><body><main>
<header><p class="eyebrow">Cordée · identité visuelle</p><a href="README.md">Guide d’usage ↗</a></header>
<h1>Une corde commune.<br>Deux boucles pour se relier.</h1>
<section class="hero" aria-label="Logo principal sur fond sombre"><img src="cordee-logo.svg" width="1016" height="256" alt="Cordée — logo principal"></section>
<div class="grid">
<section class="card light"><h2>Fond clair</h2><div class="lockup"><img src="cordee-logo-clair.svg" width="1016" height="256" alt="Cordée sur fond clair"></div><p>Accent #4124fb · mot #161616.</p></section>
<section class="card"><h2>Monochrome</h2><div class="lockup">''' + mono + '''</div><p>Un seul aplat, hérité de currentColor. Aucun effet nécessaire.</p></section>
<section class="card light"><h2>Symbole · tailles réelles</h2><div class="sizes">''' + ladder_light + '''</div><p>De 16 à 64 px. Les deux œillets restent ouverts.</p></section>
<section class="card"><h2>Symbole inversé · tailles réelles</h2><div class="sizes">''' + ladder_dark + '''</div><p>Blanc #f9fbff sur #161616. Géométrie identique.</p></section>
<section class="card blue"><h2>Inversé sur l’accent</h2><div class="lockup">''' + reverse + '''</div><p>Le symbole et le mot emploient exactement la même couleur.</p></section>
<section class="card"><h2>Icône &amp; onglet</h2><div class="icon-row"><img class="app" src="icone-512.png" width="136" height="136" alt="Icône de Cordée"><div><div class="tab"><img src="favicon-16.png" width="16" height="16" alt="">Cordée · coffre partagé</div><div class="favicons"><img src="favicon-16.png" width="16" height="16" alt="Favicon réel, 16 pixels"><img src="favicon-32.png" width="32" height="32" alt="Favicon réel, 32 pixels"><span class="caption">16 / 32 px réels</span></div></div></div><p>Tuile #161616, coins arrondis, symbole blanc pour préserver le contraste.</p></section>
<section class="card"><h2>Raster · inspection des pixels</h2><div class="pixel-row">''' + pixel_cards + '''</div><p>Agrandissement sans lissage des vrais fichiers PNG.</p></section>
<section class="card light"><h2>Monochrome noir</h2><div class="lockup">''' + preview_lockup('noir') + '''</div><p>Les contreformes sont de vrais évidements, sans caches blancs.<br>Lettrage original en tracés, accent compris.</p></section>
</div>
<div class="concepts" aria-label="Trois pistes étudiées">
<article class="concept chosen"><div class="thumb"><img src="explorations/a-attache-v2.svg" alt="Piste A"></div><h3>A · Le C d’attache — retenu</h3><p>Une initiale mémorisable, deux boucles égales et un seul lien. Le signe garde son sens en une couleur.</p></article>
<article class="concept"><div class="thumb"><img src="explorations/b-fil-v1.svg" alt="Piste B"></div><h3>B · Le fil commun</h3><p>Trois points sur un fil continu. En petit, la forme évoque surtout un S ou un itinéraire.</p></article>
<article class="concept"><div class="thumb"><img src="explorations/c-replis-v1.svg" alt="Piste C"></div><h3>C · Les deux replis</h3><p>Deux éléments se rejoignent. La silhouette est solide, mais la lecture de maillon reste plus générique.</p></article>
</div>
<footer><span>Dessin original · aucun fichier de police · aucun appel réseau</span><span><a href="verification/rapport.md">Tests effectués &amp; limites</a> · <a href="explorations/recherche.md">Recherche &amp; choix</a></span></footer>
</main></body></html>''')

if __name__ == '__main__':
    print('Pistes, cinq SVG de production et aperçu construits dans brand/.')
