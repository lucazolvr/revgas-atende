# Põe (ou tira) o item "Pedidos de hoje" no menu lateral do Chatwoot, conforme o PAINEL_TOKEN:
# com token, injeta o menu.js do bot; sem token, tira o item. Roda pelo scripts/chatwoot-ajustes.rb
# (serviço chatwoot-ajustes do docker compose).
# Usa DASHBOARD_SCRIPTS, configuração do núcleo open source (MIT) para scripts no painel; não usa
# código do plano Enterprise. A configuração é dividida com o tema (aplicar-marca.rb): cada script
# troca só o seu bloco, entre <!-- revgas:NOME --> e <!-- /revgas:NOME -->.
require_relative 'menu-html' # html_do_menu

def com_bloco(atual, nome, html)
  ini = "<!-- revgas:#{nome} -->"
  fim = "<!-- /revgas:#{nome} -->"
  sem = atual.to_s.gsub(/#{Regexp.escape(ini)}.*?#{Regexp.escape(fim)}\n?/m, '')
  html.to_s.empty? ? sem : "#{sem}#{ini}#{html}#{fim}\n"
end


token = ENV.fetch('PAINEL_TOKEN', '').strip
if !token.empty? && token.length < 32 # mesmo mínimo do bot (TOKEN_PAINEL_MINIMO em src/config.ts)
  puts '! PAINEL_TOKEN com menos de 32 caracteres: o bot desliga o painel, então o menu também fica de fora'
  token = ''
end
url = ENV.fetch('PAINEL_URL', '').strip
url = 'http://127.0.0.1:3001' if url.empty?
html = token.empty? ? '' : html_do_menu(url, token)

config = InstallationConfig.find_or_initialize_by(name: 'DASHBOARD_SCRIPTS')
config.value = com_bloco(config.value, 'menu', html)
config.locked = false
config.save!
GlobalConfig.clear_cache
puts(html.empty? ? '✓ menu "Pedidos de hoje" desligado (sem PAINEL_TOKEN)' : '✓ menu "Pedidos de hoje" aplicado')
