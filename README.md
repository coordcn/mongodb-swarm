mongodb-swarm
===========

Scripts and compose files to orchestrate the deployment of a MongoDB cluster running on Docker containers. The deployment is based on a Docker Swarm cluster, using docker-machine with the ec2 driver (to deploy on AWS), docker-compose (to build multi-container services) and the Docker cgroups implementation to define resource limits to each container.


Requirements
-----

This project requires the following binaries to be installed and configured in your environment:

* docker (version 1.0 or higher)
* docker-compose
* docker-machine
* mongo shell 

Additionally, to deploy to AWS ec2 instances, your ec2 command line should be already configured with usual key and token.

MongoDB World Demo: Deploying a sharded cluster in a docker swarm on AWS
-----

**Demo files**

The compose files used during the MongoDB World demo are available in the demo directory:

[https://github.com/sisteming/mongodb-swarm/tree/master/demo](https://github.com/sisteming/mongodb-swarm/tree/master/demo)


**Asciicinema screencast**:

[![asciicast](https://asciinema.org/a/5ve3u32kh4q65j5pl2iztjwzv.png)](https://asciinema.org/a/5ve3u32kh4q65j5pl2iztjwzv)


Steps to deploy a Swarm cluster with docker-machine running on AWS ec2 instances 
-----

Pre-start notes and considerations

***Local configuration:***

	/Users/marco/.docker/machine/machines/
	
***Keypair in AWS***

If removing machines, the respective keypair in AWS needs to be removed before creating a new one with the same name
	
***Security group in AWS***

Docker Machine creates a security group called docker-machine. Ensure docker-machine security group in AWS has the right ports for Consul, docker and MongoDB:

	Custom TCP Rule TCP 3376 0.0.0.0/0
	Custom TCP Rule TCP 8400 0.0.0.0/0
	SSH TCP 22 0.0.0.0/0
	Custom TCP Rule TCP 2376 0.0.0.0/0
	Custom TCP Rule TCP 8500 0.0.0.0/0
	Custom TCP Rule TCP 8300 - 8302 0.0.0.0/0

* Docker Machine already opens TCP ports 22 (SSH) and 2376 (Docker).
* We need to add UDP port 4789 (VXLAN used by the overlay networking driver)
* And also TCP ports 7946 and 8500 (Consul).
* And because it's nice for debugging, let's add ICMP (for ping) too.

Create an instance to host the discovery service (Consul)
-----
	docker-machine create --driver amazonec2 --amazonec2-region eu-west-1 \
	--amazonec2-tags owner,myusername,expire-on,2016-07-15 \
	--amazonec2-instance-type m3.large \
	marcob-MDBW-consul-machine

	docker-machine env marcob-MDBW-consul-machine
	eval $(docker-machine env marcob-MDBW-consul-machine)


Start the consul discovery service
-----
Getting the right IP address to connect to Consul is key for Swarm multi-host networking to work. On AWS this is eth0 but it might change in other platforms.

	export KV_IP=$(docker-machine ssh marcob-MDBW-consul-machine 'ifconfig eth0 | grep "inet addr:" | cut -d: -f2 | cut -d" " -f1')
	
Start a container running consul:	
	
	docker run -d \
	      -p ${KV_IP}:8500:8500 \
	      -h consul \
	      --restart always \
	      progrium/consul -server -bootstrap


#Create our Docker Swarm cluster using Docker Machine

**Create a first instance for the Swarm master**

	docker-machine create --driver amazonec2 --amazonec2-region eu-west-1 \
	--amazonec2-tags owner,marco.bonezzi,expire-on,2016-12-15 \
	--amazonec2-root-size 80 --amazonec2-use-ebs-optimized-instance \
	--amazonec2-instance-type m3.2xlarge \
	--swarm --swarm-master --swarm-discovery="consul://${KV_IP}:8500" \
	--engine-opt="cluster-store=consul://${KV_IP}:8500" \
	--engine-opt="cluster-advertise=eth0:2376" marcob-swarm-master


**Connect our Docker client to the new Swarm master**

	eval "$(docker-machine env --swarm marcob-MDBW-swarm-master)"


**Create and deploy a number of Swarm worker nodes**

Let's deploy 3 worker nodes for the cluster:

	export NUM_WORKERS=3; for i in $(seq 1 $NUM_WORKERS); do
     echo "Creating marcob-swarm-node-$i..."
     docker-machine create --driver amazonec2 --amazonec2-region eu-west-1 \
     --amazonec2-tags owner,marco.bonezzi,expire-on,2016-12-15 \
     --amazonec2-root-size 80 --amazonec2-use-ebs-optimized-instance \
     --amazonec2-instance-type m3.2xlarge \
     --swarm --swarm-discovery="consul://${KV_IP}:8500" \
     --engine-opt="cluster-store=consul://${KV_IP}:8500" \
     --engine-opt="cluster-advertise=eth0:2376" marcob-swarm-node-${i} &
	done;


**Bootstrap your environment**

The steps below are covered in [this shell script](https://github.com/sisteming/mongodb-swarm/blob/master/demo/createNodes-swarm.sh) that will set up all the above:

	https://github.com/sisteming/mongodb-swarm/blob/master/demo/createNodes-swarm.sh
	
Running it as:

	./createNodes-swarm.sh
	
you should get the nodes created in AWS as defined in the createNodes-swarm.sh script.

**List all the created nodes with docker-machine:**

	docker-machine ls

**Connect to the Swarm cluster and find some information about it:**

	eval "$(docker-machine env --swarm marcob-MDBW-swarm-master)"
	
**List all containers running on the Swarm:**

	eval "$(docker-machine env --swarm marcob-MDBW-swarm-master)"
	docker ps

**List nodes in the cluster with the following command:**

	docker run swarm list consul://${KV_IP}:8500

Steps to a MongoDB sharded cluster with mongod processes
-----
Once we have a Swarm cluster deployed using Docker Machine (and after having all pre-required binaries installed), we can deploy it with the following commands:

**Move to demo directory**

	cd demo

**Source the Docker environment variables to connect to the Swarm master**	

	eval $(docker-machine env --swarm marcob-swarm-master)

**Deploy all required mongod containers to our Docker swarm nodes (on AWS)**

	docker-compose up -d
	
**Check all containers are deployed**

	docker ps

**Configure each shard as replica set**

The following script will connect to the first instance for each shard (including the config server replica set) and configure the replic set.

	./replSet.sh

**Configure shards for the cluster**

The following script will connect to the mongos and add all three shards for the cluster.

	./addShard.sh

**Connect to the mongos**

At this point, our sharded cluster on docker containers is deployed on the swarm and configured to be used.

Connect to the mongos by getting its host IP from `docker ps` and connecting with the mongo shell:

	mongo --host $mongos_host_ip 

**Confirm the cluster status**

Run the following command to verify the three existing shards:

	sh.status()
	
	mongo --host 52.213.243.10 --port 27017
	MongoDB shell version v3.4.0-rc3
	connecting to: mongodb://52.213.243.10:27017/
	MongoDB server version: 3.4.0-rc3
	Server has startup warnings:
	2016-11-21T16:40:42.449+0000 I CONTROL  [main]
	2016-11-21T16:40:42.449+0000 I CONTROL  [main] ** WARNING: Access control is not enabled for the database.
	2016-11-21T16:40:42.449+0000 I CONTROL  [main] **          Read and write access to data and configuration is unrestricted.
	2016-11-21T16:40:42.449+0000 I CONTROL  [main] ** WARNING: You are running this process as the root user, which is not recommended.
	2016-11-21T16:40:42.449+0000 I CONTROL  [main]
	MongoDB Enterprise mongos> sh.status()
	--- Sharding Status ---
	  sharding version: {
		"_id" : 1,
		"minCompatibleVersion" : 5,
		"currentVersion" : 6,
		"clusterId" : ObjectId("583323a772207d0861f455d9")
	}
	  shards:
		{  "_id" : "replset_1",  "host" : "replset_1/rs1a:27017,rs1b:27017,rs1c:27017",  "state" : 1 }
		{  "_id" : "replset_2",  "host" : "replset_2/rs2a:27017,rs2b:27017,rs2c:27017",  "state" : 1 }
		{  "_id" : "replset_3",  "host" : "replset_3/rs3a:27017,rs3b:27017,rs3c:27017",  "state" : 1 }
	  active mongoses:
		"3.4.0-rc3" : 1
	 autosplit:
		Currently enabled: yes
	  balancer:
		Currently enabled:  yes
		Currently running:  no
			Balancer lock taken at Mon Nov 21 2016 16:41:11 GMT+0000 (GMT) by ConfigServer:Balancer
		Failed balancer rounds in last 5 attempts:  5
		Last reported error:  Cannot accept sharding commands if not started with --shardsvr
		Time of Reported error:  Mon Nov 21 2016 19:18:49 GMT+0000 (GMT)
		Migration Results for the last 24 hours:
			No recent migrations
	  databases:
	

	
ToDo
----	
- Create DAB to package and automate the deployment
