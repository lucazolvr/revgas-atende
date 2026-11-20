# Põe (ou tira) o item "Pedidos de hoje" no menu lateral do Chatwoot. Chamado pelo
# npm run chatwoot:config, que passa o HTML em REVGAS_MENU_HTML (vazio = tira o item):
#   docker compose exec -T -e REVGAS_MENU_HTML='<script ...>' chatwoot bundle exec rails runner "$(cat scripts/aplicar-menu.rb)"
# Usa DASHBOARD_SCRIPTS, configuração do núcleo open source (MIT) para scripts no painel; não usa
# código do plano Enterprise. A configuração é dividida com o tema (aplicar-marca.rb): cada script
# troca só o seu bloco, entre <!-- revgas:NOME --> e <!-- /revgas:NOME -->.

def com_bloco(atual, nome, html)
  ini = "<!-- revgas:#{nome} -->"
  fim = "<!-- /revgas:#{nome} -->"
  sem = atual.to_s.gsub(/#{Regexp.escape(ini)}.*?#{Regexp.escape(fim)}\n?/m, '')
  html.to_s.empty? ? sem : "#{sem}#{ini}#{html}#{fim}\n"
end

config = InstallationConfig.find_or_initialize_by(name: 'DASHBOARD_SCRIPTS')
config.value = com_bloco(config.value, 'menu', ENV.fetch('REVGAS_MENU_HTML', ''))
config.locked = false
config.save!
GlobalConfig.clear_cache
puts(ENV.fetch('REVGAS_MENU_HTML', '').empty? ? '✓ menu "Pedidos de hoje" removido' : '✓ menu "Pedidos de hoje" aplicado')
