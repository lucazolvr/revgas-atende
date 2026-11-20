# Ajustes que precisam rodar dentro do Chatwoot (rails runner), a cada `docker compose up`
# (serviço chatwoot-ajustes, depois do chatwoot-config). Pode rodar de novo sem problema:
#   1. marca RevGás: nome, logo, ícone e tema laranja (aplicar-marca.rb);
#   2. item "Pedidos de hoje" no menu lateral (aplicar-menu.rb);
#   3. renova o cache do painel: o Chatwoot versiona o cache de etiquetas do navegador pelo segundo
#      da última alteração, e etiquetas criadas no mesmo segundo apareciam pela metade.
# À mão: docker compose run --rm chatwoot-ajustes
load File.join(__dir__, 'aplicar-marca.rb')
load File.join(__dir__, 'aplicar-menu.rb')
Account.find_each(&:reset_cache_keys)
puts '✓ cache do painel renovado'
