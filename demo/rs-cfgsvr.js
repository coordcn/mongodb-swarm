rs.initiate()
rs.add("cfgsvr-b:27017")
rs.add("cfgsvr-c:27017")
rs.conf()
rs.status()